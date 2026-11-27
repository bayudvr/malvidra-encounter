import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
const req=createRequire(import.meta.url);
function load(path, imports={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function("require","module","exports",code)(name=>name in imports?imports[name]:req(name),mod,mod.exports);
 return mod.exports;
}
const activity=load("../src/lib/encounter-activity.ts");
const media=load("../src/lib/activity-media.ts",{"@/lib/encounter-activity":activity});
test("media accepts only known HTTPS hosts and rejects credentials, ports, arbitrary hosts",()=>{
 assert.ok(media.allowedImage("https://i.imgur.com/a.png"));
 for(const url of ["http://i.imgur.com/a.png","https://i.imgur.com.evil.test/a.png","https://i.imgur.com:444/a.png","https://x@i.imgur.com/a.png","https://127.0.0.1/","file:///etc/passwd"])assert.equal(media.allowedImage(url),null);
});
test("reference paths are confined to fixed upstream JSON directory",()=>{
 assert.match(media.allowedReference(["bestiary","bestiary-xmm.json"]).href,/\/main\/data\/bestiary\/bestiary-xmm.json$/);
 for(const path of [["..","a.json"],["%2e%2e","a.json"],["http:","a.json"],["x.js"],["x/y.json"]])assert.equal(media.allowedReference(path),null);
});
test("proxy rejects executable content and disables sniffing",()=>{
 assert.equal(media.IMAGE_TYPES.has("image/svg+xml"),false);
 assert.equal(media.IMAGE_TYPES.has("text/html"),false);
 assert.equal(media.safeHeaders("image/png")["X-Content-Type-Options"],"nosniff");
 assert.match(media.safeHeaders("image/png")["Content-Security-Policy"],/sandbox/);
});
