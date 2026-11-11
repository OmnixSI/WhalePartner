import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebService, isPrivateAddress, WebError } from "../src/webpage/service.ts";

test("IPv4-mapped, NAT64 and other encodings of private addresses are all rejected", () => {
  const blocked = [
    "::ffff:7f00:1", "::ffff:c0a8:101", "[::ffff:7f00:1]", "0:0:0:0:0:ffff:7f00:1", "::ffff:127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::c0a8:101", "::7f00:1", "ff02::1", "224.0.0.1", "255.255.255.255",
    "fe80::1%en0", "64:ff9b:1::1",
  ];
  for (const address of blocked) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["::ffff:808:808", "64:ff9b::808:808", "8.8.8.8", "2606:4700:4700::1111", "example.com"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("reading a link written as a hex IPv4-mapped address is refused before any request", async () => {
  const web = createWebService();
  await assert.rejects(web.read("http://[::ffff:7f00:1]:9/"), (error: unknown) => error instanceof WebError && /内部地址/.test(error.message));
  await assert.rejects(web.read("http://[::ffff:c0a8:101]/"), (error: unknown) => error instanceof WebError);
});
