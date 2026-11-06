# Live2D runtime and model licensing

Status as of 2026-11-06: runtime selection is waiting for an owner decision. No SDK or model files have been downloaded or added to WhalePartner.

## Runtime findings

The official Cubism Web SDK uses two separately licensed components:

- `CubismWebFramework` is distributed under Live2D Open Software License, which is not MIT or Apache-2.0. The framework requires Cubism Core to load and render Cubism models.
- Cubism Core is proprietary and is not published in the public framework repository. The official Web SDK package contains it.
- The official download page requires agreement to both the Live2D Proprietary Software License Agreement and Live2D Open Software License Agreement; it states that downloading or launching the SDK constitutes consent.
- Live2D describes SDK development as available without an initial fee subject to those agreements. Release terms vary by use; its AI/chatbot flow includes an expandable-application review path. Individual and small-scale exemptions have conditions and do not remove the SDK download agreements.

Official references: [Cubism Web SDK manual](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/), [Web SDK download and agreements](https://www.live2d.com/en/sdk/download/web/), [SDK release licensing, including AI/chatbot use](https://www.live2d.com/en/sdk/license/), and the [CubismWebFramework license](https://github.com/Live2D/CubismWebFramework/blob/develop/LICENSE.md).

## Model findings

The license for a Live2D model is separate from the renderer. Each model must be checked for use in an AI companion, redistribution in an installed application, modification, and required attribution. Public availability does not grant those rights. The official sample-model license also has per-model conditions: [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) and [official sample-model FAQ](https://help.live2d.com/en/other/other_16/).

## Decision needed

Choose one direction before runtime integration:

1. Keep the repository's MIT/Apache-2.0 code reuse constraint and choose an avatar format/runtime that meets it. This does not satisfy Issue #39's Live2D acceptance condition.
2. Permit the official Cubism runtime as a separately licensed dependency. The owner must first review and accept the SDK download agreements, then confirm that the application's intended use fits Live2D's AI/chatbot release terms. A model with documented app-use and redistribution rights must be selected separately.

The current branch continues with the chat, diary, memory, settings, and recovery work. Live2D remains unimplemented until this decision is recorded.
