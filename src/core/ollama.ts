// Talks to Ollama, the program that runs AI models locally on this machine.
// It is a small web server at http://localhost:11434; nothing leaves the
// computer.

import { CompleteOptions, LanguageModel } from "./llm";

// How to send a POST request is passed in rather than hard-coded, because
// each host app has its own way (Obsidian has requestUrl, a standalone app
// might use fetch).
export type PostJson = (url: string, body: unknown) => Promise<any>;

// A local chat model run by Ollama (e.g. qwen2.5:3b). Free and private, but
// much smaller than Claude, so it's used for small, well-defined jobs like
// suggesting tags. It can't search the web.
export class OllamaChatModel implements LanguageModel {
  constructor(
    private post: PostJson,
    private baseUrl: string,
    private model: string,
  ) {}

  async complete(system: string, prompt: string, options: CompleteOptions = {}): Promise<string> {
    const response = await this.post(`${this.baseUrl}/api/chat`, {
      model: this.model,
      stream: false,
      // A JSON schema here makes Ollama return valid JSON in that shape.
      ...(options.jsonSchema ? { format: options.jsonSchema } : {}),
      options: { temperature: 0.2 }, // steady, not creative
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    return response.message.content;
  }
}

export class OllamaClient {
  constructor(
    private post: PostJson,
    private baseUrl: string,
    private embedModel: string,
  ) {}

  // Turn texts into embeddings: lists of numbers where texts about similar
  // things end up close together.
  //
  // nomic-embed-text was trained with these two prefixes. Marking which side
  // is the stored note and which is the search query noticeably improves
  // results.
  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    const prefix = kind === "document" ? "search_document: " : "search_query: ";
    const response = await this.post(`${this.baseUrl}/api/embed`, {
      model: this.embedModel,
      input: texts.map((t) => prefix + t),
    });
    return response.embeddings;
  }
}
