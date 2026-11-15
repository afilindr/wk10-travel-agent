import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

/**
 * A deterministic chat model for tests. Each model call consumes the next scripted response:
 *   - a string                      -> plain text reply
 *   - { content, toolCalls: [...] } -> reply that requests tool calls
 * Every call's input messages are recorded in `calls` for assertions (e.g. the system prompt).
 */
export class ScriptedChatModel extends BaseChatModel {
  constructor(responses = []) {
    super({});
    this.responses = [...responses];
    this.calls = [];
  }

  _llmType() {
    return "scripted";
  }

  bindTools() {
    return this;
  }

  async _generate(messages) {
    this.calls.push(messages);
    if (this.responses.length === 0) {
      throw new Error("ScriptedChatModel: no scripted responses left");
    }
    const next = this.responses.shift();
    const message =
      typeof next === "string"
        ? new AIMessage(next)
        : new AIMessage({
            content: next.content ?? "",
            tool_calls: (next.toolCalls ?? []).map((tc, i) => ({
              id: tc.id ?? `call_${this.calls.length}_${i}`,
              type: "tool_call",
              name: tc.name,
              args: tc.args ?? {},
            })),
          });
    return {
      generations: [{ text: typeof message.content === "string" ? message.content : "", message }],
    };
  }
}

/** The system prompt text the model saw on a given call. */
export function systemPromptOf(call) {
  const sys = call.find((m) => m.type === "system" || m._getType?.() === "system");
  if (!sys) return "";
  return typeof sys.content === "string"
    ? sys.content
    : sys.content.map((b) => b.text ?? "").join("");
}
