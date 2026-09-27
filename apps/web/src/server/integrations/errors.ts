import "server-only";
export class IntegrationError extends Error {
  constructor(public provider: "OpenAI" | "Jinko", public code: string, message: string) { super(message); }
}
export type Audit = (title: string, detail?: string, data?: Record<string, unknown>) => Promise<void>;
