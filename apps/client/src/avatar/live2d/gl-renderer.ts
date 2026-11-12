/**
 * Cubism 4 WebGL 绘制路径的替换实现（只换 drawMesh，排序、蒙版布局、着色器都沿用原版）。
 *
 * 原版 CubismRenderer_WebGL 所有部件共用一组 vertex / uv / index 缓冲：每画一个部件就把三份数据
 * 重新 bufferData 一遍（大肥鱼约 100 次绘制，每帧 300 多次缓冲重建），并且每次都重设程序、属性指针、
 * 采样器、矩阵、纹理和混合，画完还 useProgram(null)，每帧约 2300 次 GL 调用。
 *
 * 这里改成：
 *   - 每个部件一个 VAO，uv 和索引只在第一次上传（STATIC_DRAW），顶点每帧最多 bufferSubData 一次
 *     （同一帧里既当蒙版又正常绘制的部件不再传两遍）；
 *   - 程序、纹理、剔除、混合、uniform 只在值变了的时候才设；MVP / 裁剪矩阵每个程序每帧最多设一次。
 * 画出来的像素与原版一致：着色器、混合方程、绘制顺序、蒙版内容都没变，只是少了重复的状态设置。
 */

interface ShaderSet {
  shaderProgram: WebGLProgram;
  attributePositionLocation: number;
  attributeTexCoordLocation: number;
  samplerTexture0Location: WebGLUniformLocation | null;
  samplerTexture1Location?: WebGLUniformLocation | null;
  uniformMatrixLocation?: WebGLUniformLocation | null;
  uniformClipMatrixLocation?: WebGLUniformLocation | null;
  uniformChannelFlagLocation?: WebGLUniformLocation | null;
  uniformBaseColorLocation: WebGLUniformLocation | null;
}

interface ShaderSingleton {
  _shaderSets: ShaderSet[];
  generateShaders(): void;
}

interface Rect { x: number; y: number; getRight(): number; getBottom(): number }
interface Color { R: number; G: number; B: number; A: number }
interface ClippingContext {
  _layoutChannelNo: number;
  _layoutBounds: Rect;
  _matrixForMask: { getArray(): Float32Array };
  _matrixForDraw: { getArray(): Float32Array };
  getClippingManager(): { getChannelFlagAsColor(channel: number): Color; getColorBuffer(): WebGLTexture | null };
}

interface CubismCoreModel {
  getDrawableCount(): number;
  getDrawableVertexIndices(index: number): Uint16Array;
}

type GL = WebGL2RenderingContext;
type Mesh = [textureNo: number, indexCount: number, vertexCount: number, indexArray: Uint16Array, vertexArray: Float32Array, uvArray: Float32Array, opacity: number, blendMode: number, invertedMask: boolean];

interface Renderer {
  gl: GL;
  _textures: Record<number, WebGLTexture>;
  getModel(): CubismCoreModel;
  getMvpMatrix(): { getArray(): Float32Array };
  getModelColor(): Color;
  isCulling(): boolean;
  isPremultipliedAlpha(): boolean;
  getClippingContextBufferForMask(): ClippingContext | null;
  getClippingContextBufferForDraw(): ClippingContext | null;
  setClippingContextBufferForMask(clip: ClippingContext | null): void;
  setClippingContextBufferForDraw(clip: ClippingContext | null): void;
  drawMesh(...mesh: Mesh): void;
  doDrawModel(): void;
  preDraw(): void;
  release(): void;
  __fast?: FastState | null;
}

interface RendererClass { prototype: Renderer }

interface Lib {
  CubismRenderer_WebGL: unknown;
  CubismShader_WebGL: { getInstance(): unknown };
}

interface DrawableGL { vao: WebGLVertexArrayObject; vertex: WebGLBuffer; uv: WebGLBuffer; index: WebGLBuffer; frame: number }

interface ProgramCache {
  samplers: boolean;
  mvpFrame: number;
  clip: ClippingContext | null;
  clipFrame: number;
  color: [number, number, number, number];
}

interface FastState {
  gl: GL;
  sets: ShaderSet[];
  posLoc: number;
  uvLoc: number;
  indexOf: Map<Uint16Array, number>;
  drawables: Array<DrawableGL | undefined>;
  programs: Map<WebGLProgram, ProgramCache>;
  frame: number;
  // 当前 GL 状态的影子；undefined 表示「不知道」，下一次一定会设
  program: WebGLProgram | null | undefined;
  unit: number | undefined;
  tex0: WebGLTexture | null | undefined;
  tex1: WebGLTexture | null | undefined;
  cull: boolean | undefined;
  frontFace: number | undefined;
  blend: string | undefined;
  vaoBound: boolean;
}

// CubismBlendMode / ShaderNames 的取值（与 pixi-live2d-display 0.4.0 内置的 Cubism 框架一致）
const BLEND_ADDITIVE = 1;
const BLEND_MULTIPLICATIVE = 2;
const SHADER_SETUP_MASK = 0;
const SHADER_NORMAL = 1;
const SHADER_ADD = 4;
const SHADER_MULT = 7;

let installed = false;

/** 把 Cubism 4 渲染器的 drawMesh 换成上面的实现；重复调用无副作用。 */
export function installFastCubismRenderer(lib: Lib) {
  if (installed) return;
  installed = true;
  const proto = (lib.CubismRenderer_WebGL as RendererClass).prototype;
  const shader = lib.CubismShader_WebGL.getInstance() as ShaderSingleton;
  const original = { drawMesh: proto.drawMesh, doDrawModel: proto.doDrawModel, preDraw: proto.preDraw, release: proto.release };

  const forget = (st: FastState) => {
    st.program = st.unit = st.tex0 = st.tex1 = st.cull = st.frontFace = st.blend = undefined;
  };

  /** 拿到（必要时新建）这个渲染器的快路径状态；条件不满足时返回 null，走原版。 */
  const stateOf = (r: Renderer): FastState | null => {
    const gl = r.gl;
    if (!gl) return null;
    if (shader._shaderSets.length === 0) shader.generateShaders();
    const sets = shader._shaderSets;
    const st = r.__fast;
    if (st && st.gl === gl && st.sets === sets) return st;
    if (st === null && r.__fast !== undefined && (r as { __fastGl?: GL }).__fastGl === gl) return null;
    if (st && st.gl === gl) dropDrawables(st);
    // 所有程序的属性位置一致才能共用一个 VAO；不一致（或没有 VAO）就整体退回原版
    const posLoc = sets[0]?.attributePositionLocation;
    const uvLoc = sets[0]?.attributeTexCoordLocation;
    const uniform = sets.length > 0 && sets.every((s) => s.attributePositionLocation === posLoc && s.attributeTexCoordLocation === uvLoc);
    if (!uniform || typeof gl.createVertexArray !== "function" || posLoc < 0 || uvLoc < 0) {
      r.__fast = null;
      (r as { __fastGl?: GL }).__fastGl = gl;
      return null;
    }
    const model = r.getModel();
    const indexOf = new Map<Uint16Array, number>();
    for (let i = model.getDrawableCount() - 1; i >= 0; i--) indexOf.set(model.getDrawableVertexIndices(i), i);
    const next: FastState = {
      gl, sets, posLoc, uvLoc, indexOf, drawables: [], programs: new Map(), frame: 0,
      program: undefined, unit: undefined, tex0: undefined, tex1: undefined, cull: undefined, frontFace: undefined, blend: undefined, vaoBound: false,
    };
    r.__fast = next;
    return next;
  };

  const dropDrawables = (st: FastState) => {
    const { gl } = st;
    for (const d of st.drawables) {
      if (!d) continue;
      gl.deleteVertexArray(d.vao);
      gl.deleteBuffer(d.vertex);
      gl.deleteBuffer(d.uv);
      gl.deleteBuffer(d.index);
    }
    st.drawables = [];
  };

  const createDrawable = (st: FastState, indices: Uint16Array, vertices: Float32Array, uvs: Float32Array): DrawableGL => {
    const { gl } = st;
    const vao = gl.createVertexArray()!;
    const vertex = gl.createBuffer()!;
    const uv = gl.createBuffer()!;
    const index = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    st.vaoBound = true;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(st.posLoc);
    gl.vertexAttribPointer(st.posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(st.uvLoc);
    gl.vertexAttribPointer(st.uvLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    return { vao, vertex, uv, index, frame: st.frame };
  };

  const programCache = (st: FastState, program: WebGLProgram) => {
    let pc = st.programs.get(program);
    if (!pc) {
      pc = { samplers: false, mvpFrame: -1, clip: null, clipFrame: -1, color: [NaN, NaN, NaN, NaN] };
      st.programs.set(program, pc);
    }
    return pc;
  };

  const useProgram = (st: FastState, set: ShaderSet) => {
    if (st.program !== set.shaderProgram) {
      st.gl.useProgram(set.shaderProgram);
      st.program = set.shaderProgram;
    }
    return programCache(st, set.shaderProgram);
  };

  const bindTexture = (st: FastState, unit: 0 | 1, texture: WebGLTexture | null) => {
    if ((unit === 0 ? st.tex0 : st.tex1) === texture) return;
    const { gl } = st;
    if (st.unit !== unit) {
      gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
      st.unit = unit;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (unit === 0) st.tex0 = texture;
    else st.tex1 = texture;
  };

  const setColor = (st: FastState, pc: ProgramCache, loc: WebGLUniformLocation | null, r: number, g: number, b: number, a: number) => {
    const c = pc.color;
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) return;
    st.gl.uniform4f(loc, r, g, b, a);
    c[0] = r; c[1] = g; c[2] = b; c[3] = a;
  };

  const setBlend = (st: FastState, sc: number, dc: number, sa: number, da: number) => {
    const key = `${sc},${dc},${sa},${da}`;
    if (st.blend === key) return;
    st.gl.blendFuncSeparate(sc, dc, sa, da);
    st.blend = key;
  };

  proto.drawMesh = function drawMesh(this: Renderer, ...mesh: Mesh) {
    const st = stateOf(this);
    const [textureNo, indexCount, , indexArray, vertexArray, uvArray, opacity, blendMode, invertedMask] = mesh;
    const drawableIndex = st?.indexOf.get(indexArray);
    if (!st || drawableIndex === undefined) {
      if (st) { forget(st); st.programs.clear(); }
      original.drawMesh.apply(this, mesh);
      return;
    }
    const { gl } = st;

    const cull = this.isCulling();
    if (st.cull !== cull) {
      if (cull) gl.enable(gl.CULL_FACE);
      else gl.disable(gl.CULL_FACE);
      st.cull = cull;
    }
    if (st.frontFace !== gl.CCW) {
      gl.frontFace(gl.CCW);
      st.frontFace = gl.CCW;
    }

    let d = st.drawables[drawableIndex];
    if (!d) {
      d = st.drawables[drawableIndex] = createDrawable(st, indexArray, vertexArray, uvArray);
    } else {
      gl.bindVertexArray(d.vao);
      st.vaoBound = true;
      if (d.frame !== st.frame) {
        gl.bindBuffer(gl.ARRAY_BUFFER, d.vertex);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexArray);
        d.frame = st.frame;
      }
    }

    const texture = this._textures[textureNo] ?? null;
    const maskClip = this.getClippingContextBufferForMask();
    if (maskClip) {
      const set = st.sets[SHADER_SETUP_MASK];
      const pc = useProgram(st, set);
      bindTexture(st, 0, texture);
      if (!pc.samplers) { gl.uniform1i(set.samplerTexture0Location, 0); pc.samplers = true; }
      if (pc.clip !== maskClip || pc.clipFrame !== st.frame) {
        const channel = maskClip.getClippingManager().getChannelFlagAsColor(maskClip._layoutChannelNo);
        gl.uniform4f(set.uniformChannelFlagLocation!, channel.R, channel.G, channel.B, channel.A);
        gl.uniformMatrix4fv(set.uniformClipMatrixLocation!, false, maskClip._matrixForMask.getArray());
        pc.clip = maskClip;
        pc.clipFrame = st.frame;
      }
      const rect = maskClip._layoutBounds;
      setColor(st, pc, set.uniformBaseColorLocation, rect.x * 2 - 1, rect.y * 2 - 1, rect.getRight() * 2 - 1, rect.getBottom() * 2 - 1);
      setBlend(st, gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      const drawClip = this.getClippingContextBufferForDraw();
      const offset = drawClip ? (invertedMask ? 2 : 1) : 0;
      let base = SHADER_NORMAL;
      if (blendMode === BLEND_ADDITIVE) {
        base = SHADER_ADD;
        setBlend(st, gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      } else if (blendMode === BLEND_MULTIPLICATIVE) {
        base = SHADER_MULT;
        setBlend(st, gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      } else {
        setBlend(st, gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      const set = st.sets[base + offset];
      const pc = useProgram(st, set);
      if (!pc.samplers) {
        gl.uniform1i(set.samplerTexture0Location, 0);
        if (set.samplerTexture1Location) gl.uniform1i(set.samplerTexture1Location, 1);
        pc.samplers = true;
      }
      if (drawClip) {
        bindTexture(st, 1, drawClip.getClippingManager().getColorBuffer());
        if (pc.clip !== drawClip || pc.clipFrame !== st.frame) {
          gl.uniformMatrix4fv(set.uniformClipMatrixLocation!, false, drawClip._matrixForDraw.getArray());
          const channel = drawClip.getClippingManager().getChannelFlagAsColor(drawClip._layoutChannelNo);
          gl.uniform4f(set.uniformChannelFlagLocation!, channel.R, channel.G, channel.B, channel.A);
          pc.clip = drawClip;
          pc.clipFrame = st.frame;
        }
      }
      bindTexture(st, 0, texture);
      if (pc.mvpFrame !== st.frame) {
        gl.uniformMatrix4fv(set.uniformMatrixLocation!, false, this.getMvpMatrix().getArray());
        pc.mvpFrame = st.frame;
      }
      const color = this.getModelColor();
      const a = color.A * opacity;
      if (this.isPremultipliedAlpha()) setColor(st, pc, set.uniformBaseColorLocation, color.R * a, color.G * a, color.B * a, a);
      else setColor(st, pc, set.uniformBaseColorLocation, color.R, color.G, color.B, a);
    }

    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    this.setClippingContextBufferForDraw(null);
    this.setClippingContextBufferForMask(null);
  };

  // 一帧的开头：pixi 刚 reset 过 GL 状态，影子作废；MVP、裁剪矩阵按新帧号重传。
  // 一帧的结尾：解绑 VAO 和程序，免得 pixi 之后的绘制改到部件的 VAO。
  proto.doDrawModel = function doDrawModel(this: Renderer) {
    const st = stateOf(this);
    if (!st) {
      original.doDrawModel.call(this);
      return;
    }
    st.frame += 1;
    forget(st);
    original.doDrawModel.call(this);
    const { gl } = st;
    if (st.vaoBound) { gl.bindVertexArray(null); st.vaoBound = false; }
    gl.useProgram(null);
    st.program = null;
  };

  // preDraw 会把 ELEMENT_ARRAY_BUFFER 绑成 null（绑着 VAO 时会把索引缓冲从 VAO 上摘掉），还会把 frontFace 设回 CW
  proto.preDraw = function preDraw(this: Renderer) {
    const st = this.__fast;
    if (st && st.vaoBound) { st.gl.bindVertexArray(null); st.vaoBound = false; }
    original.preDraw.call(this);
    if (st) forget(st);
  };

  proto.release = function release(this: Renderer) {
    const st = this.__fast;
    if (st && this.gl === st.gl) dropDrawables(st);
    this.__fast = undefined;
    original.release.call(this);
  };
}
