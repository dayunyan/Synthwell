import { test } from "node:test";
import assert from "node:assert";
import { parseLLMJson } from "./llm-json.ts";

test("parseLLMJson: 干净 JSON 数组", () => {
  const out = parseLLMJson<unknown[]>('[{"a":1},{"b":2}]');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});
test("parseLLMJson: 去 ```json code fence", () => {
  const out = parseLLMJson<unknown[]>('```json\n[{"a":1}]\n```');
  assert.deepEqual(out, [{ a: 1 }]);
});
test("parseLLMJson: 前后有解释文字也能提取", () => {
  const out = parseLLMJson<unknown[]>('好的,以下是结果:\n[{"title":"飞轮"}]\n以上。');
  assert.deepEqual(out, [{ title: "飞轮" }]);
});
test("parseLLMJson: 非法返回 null(不抛)", () => {
  assert.equal(parseLLMJson("not json at all"), null);
});
test("parseLLMJson: 对象也行", () => {
  const out = parseLLMJson<{ x: number }>('{"x":5}');
  assert.deepEqual(out, { x: 5 });
});
