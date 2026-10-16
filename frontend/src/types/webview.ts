/** Native host startup options. All false preserves the existing WebView2 behavior. */
export interface WebViewSettings {
  gpuCompositing: boolean;
  rendererBackgrounding: boolean;
  cacheEnabled: boolean;
  openDevToolsOnStartup: boolean;
}

export const DEFAULT_WEBVIEW_SETTINGS: Readonly<WebViewSettings> = {
  gpuCompositing: false,
  rendererBackgrounding: false,
  cacheEnabled: false,
  openDevToolsOnStartup: false,
};
