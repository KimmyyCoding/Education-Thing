// A language model that can answer a prompt. Commands only talk to this
// interface, so the model behind it can be swapped (Claude, ChatGPT, a local
// model) without touching the commands themselves.
export interface LanguageModel {
  complete(system: string, prompt: string, options?: CompleteOptions): Promise<string>;
}

export interface CompleteOptions {
  webSearch?: boolean; // let the model look things up online
  jsonSchema?: object; // ask for JSON in this shape (models that support it)
}
