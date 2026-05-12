// WebView2 が注入する IPC エントリポイント。bridge / ipc-invoker / logger から参照される。
declare global {
  interface Window {
    invoke?: (request: string) => Promise<string>;
  }
}

export {};
