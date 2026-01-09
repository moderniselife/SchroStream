declare module 'vosk' {
  export function setLogLevel(level: number): void;
  
  export class Model {
    constructor(modelPath: string);
    free(): void;
  }
  
  export class Recognizer {
    constructor(options: { model: Model; sampleRate: number });
    acceptWaveform(data: Buffer): boolean;
    result(): string;
    partialResult(): string;
    finalResult(): string;
    free(): void;
  }
}
