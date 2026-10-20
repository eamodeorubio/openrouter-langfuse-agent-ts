export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Answer {
  text: string;
  model: string;
  usage: Usage;
}
