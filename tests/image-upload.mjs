import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const roomId = "11111111-1111-4111-8111-111111111111";
const url = `http://localhost:3000/api/rooms/${roomId}/images`;
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");

function loadModule(path, imports, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, require: (id) => {
      assert.ok(id in imports, `Unexpected import: ${id}`);
      return imports[id];
    },
    Buffer, File, FormData, Request, Response, URL, AbortSignal, Uint8Array,
    ...globals,
  }, { filename: path });
  return exports;
}

const validation = loadModule("../src/lib/image-upload.ts", {});

const uiImports = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/components/ui": {
    Panel: ({ children }) => React.createElement("section", null, children),
    Button: ({ children, disabled, type }) => React.createElement("button", { disabled, type }, children),
    Input: (props) => React.createElement("input", props),
    Label: (props) => React.createElement("label", props),
  },
  "@/components/toast": { useToast: () => ({ error() {} }) },
  "@/components/room/ImageUploadButton": {
    ImageUploadButton: ({ roomId }) => {
      assert.ok(roomId, "Upload must have a loaded room ID");
      return React.createElement("button", { "data-upload-room": roomId }, "Upload to Imgur");
    },
  },
  "@/components/room/TokenFolderManager": {
    TokenFolderManager: () => null,
  },
  "@/lib/utils": {},
};

test("scene form waits for the room to load before rendering its upload control", () => {
  const { SceneList } = loadModule("../src/components/room/SceneList.tsx", uiImports);
  const room = { room: null, role: "dm", scenes: [] };
  const loading = renderToStaticMarkup(React.createElement(SceneList, { room }));
  assert.ok(!loading.includes("Upload to Imgur"));
  const ready = renderToStaticMarkup(React.createElement(SceneList, {
    room: { ...room, room: { id: roomId } },
  }));
  assert.ok(ready.includes(`data-upload-room="${roomId}"`));
  assert.ok(ready.includes("Add scene"));
});

test("new-token control stays disabled until its room is loaded", () => {
  const { AssetPanel } = loadModule("../src/components/room/AssetPanel.tsx", uiImports);
  const room = { room: null, assets: [], members: [] };
  const loading = renderToStaticMarkup(React.createElement(AssetPanel, { room }));
  assert.match(loading, /<button[^>]*disabled[^>]*>\+ New token<\/button>/);
  const ready = renderToStaticMarkup(React.createElement(AssetPanel, {
    room: { ...room, room: { id: roomId } },
  }));
  assert.ok(!ready.includes("disabled"));
});

test("folder controls handle loading, saved folders, and a pending database update", () => {
  const { TokenFolderManager } = loadModule("../src/components/room/TokenFolderManager.tsx", uiImports);
  const room = { room: null, assets: [], assetFolders: [], loading: true };
  const render = (state) => renderToStaticMarkup(React.createElement(TokenFolderManager, {
    room: state, selected: "all", onSelect() {},
  }));
  assert.match(render(room), /\sdisabled=""/);
  const ready = {
    ...room, room: { id: roomId }, loading: false,
    assetFolders: [{ id: "party", room_id: roomId, name: "Party" }],
    assets: [{ folder_id: "party" }, { folder_id: null }],
  };
  const html = render(ready);
  assert.ok(html.includes("All tokens (2)"));
  assert.ok(html.includes("Unfiled (1)"));
  assert.ok(html.includes("Party (1)"));
  assert.doesNotMatch(html, /\sdisabled=""/);
  const pending = render({ ...ready, assetFoldersError: "Database update pending" });
  assert.ok(pending.includes("Database update pending"));
  assert.match(pending, /\sdisabled=""/);
});

function setup({ role = "dm", user = { id: "dm-user" }, configured = true,
  memberError = null, upstreamStatus = 200, upstreamBody, fetchError } = {}) {
  const uploads = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      assert.equal(table, "room_members");
      const filters = {};
      return {
        select(columns) { assert.equal(columns, "role"); return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          assert.deepEqual(filters, { room_id: roomId, user_id: user.id });
          return { data: role ? { role } : null, error: memberError };
        },
      };
    },
  };
  const { POST } = loadModule("../src/app/api/rooms/[roomId]/images/route.ts", {
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/image-upload": validation,
  }, {
    process: { env: configured ? { IMGUR_CLIENT_ID: "test-client-id" } : {} },
    fetch: async (endpoint, options) => {
      uploads.push({ endpoint, options });
      if (fetchError) throw new Error("upstream unavailable");
      return Response.json(upstreamBody ?? {
        success: true, data: { link: "https://i.imgur.com/Test123.png", deletehash: "private-delete-hash" },
      }, { status: upstreamStatus });
    },
  });
  return { uploads, send: (request = imageRequest()) => POST(request, { params: Promise.resolve({ roomId }) }) };
}

function imageRequest({ bytes = png, type = "image/png", headers } = {}) {
  const form = new FormData();
  form.set("image", new File([bytes], "test.png", { type }));
  return new Request(url, { method: "POST", body: form, headers });
}

for (const [name, options, status] of [
  ["requires login", { user: null }, 401],
  ["rejects players", { role: "player" }, 403],
  ["rejects spectators", { role: "spectator" }, 403],
  ["rejects users outside this room", { role: null }, 403],
  ["fails closed on membership lookup errors", { memberError: { message: "unavailable" } }, 503],
  ["handles missing Imgur configuration", { configured: false }, 503],
]) {
  test(name, async () => {
    const app = setup(options);
    assert.equal((await app.send()).status, status);
    assert.equal(app.uploads.length, 0);
  });
}

for (const [name, request, status] of [
  ["rejects cross-origin uploads", () => imageRequest({ headers: { origin: "https://other.example" } }), 403],
  ["rejects SVG", () => imageRequest({ type: "image/svg+xml" }), 400],
  ["rejects disguised non-images", () => imageRequest({ bytes: Buffer.from("<script>bad</script>") }), 400],
  ["rejects empty images", () => imageRequest({ bytes: Buffer.alloc(0) }), 400],
  ["rejects images larger than 4 MB", () => imageRequest({ bytes: Buffer.alloc(validation.MAX_IMAGE_BYTES + 1) }), 413],
  ["rejects missing file", () => new Request(url, { method: "POST", body: new FormData() }), 400],
  ["rejects malformed multipart requests", () => new Request(url, { method: "POST", body: "broken" }), 400],
]) {
  test(name, async () => {
    const app = setup();
    assert.equal((await app.send(request())).status, status);
    assert.equal(app.uploads.length, 0);
  });
}

test("DM upload uses server credentials and returns only the direct image URL", async () => {
  const app = setup();
  const response = await app.send();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: "https://i.imgur.com/Test123.png" });
  assert.equal(app.uploads.length, 1);
  const { endpoint, options } = app.uploads[0];
  assert.equal(endpoint, "https://api.imgur.com/3/image");
  assert.equal(options.headers.Authorization, "Client-ID test-client-id");
  assert.equal(options.body.get("type"), "base64");
  assert.deepEqual(Buffer.from(options.body.get("image"), "base64"), png);
});

for (const [name, options, status] of [
  ["handles Imgur rate limits", { upstreamStatus: 429 }, 429],
  ["handles rejected uploads", { upstreamStatus: 403 }, 502],
  ["handles network failures", { fetchError: true }, 502],
  ["rejects unexpected returned URLs", { upstreamBody: { success: true, data: { link: "https://other.example/file.png" } } }, 502],
  ["rejects unsuccessful API results", { upstreamBody: { success: false } }, 502],
]) {
  test(name, async () => {
    const app = setup(options);
    const response = await app.send();
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.ok(!JSON.stringify(body).includes("test-client-id"));
    assert.ok(!JSON.stringify(body).includes("private-delete-hash"));
  });
}
