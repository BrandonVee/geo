"use client";

import "@ant-design/v5-patch-for-react-19";
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "dark" | "light";

const ThemeContext = createContext<{
  mode: ThemeMode;
  toggle: () => void;
}>({ mode: "light", toggle: () => {} });

export function useThemeMode() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "ab-theme";

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [themeRestored, setThemeRestored] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setMode(saved);
    setThemeRestored(true);
  }, []);

  useEffect(() => {
    if (!themeRestored) return;
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode, themeRestored]);

  const toggle = useCallback(() => {
    setMode((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <ConfigProvider
        componentSize="large"
        locale={zhCN}
        theme={{
          algorithm:
            mode === "dark"
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: mode === "dark" ? "#6366f1" : "#4f46e5",
            colorPrimaryHover: mode === "dark" ? "#818cf8" : "#4338ca",
            colorPrimaryActive: mode === "dark" ? "#4f46e5" : "#3730a3",
            // Ant Design uses colorInfo for processing tags and badges. Keep the
            // light-theme foreground dark enough for 12px status labels on the
            // generated pale background.
            colorInfo: mode === "dark" ? "#818cf8" : "#4f46e5",
            colorLink: mode === "dark" ? "#a5b4fc" : "#4f46e5",
            colorBgLayout: mode === "dark" ? "#0f1420" : "#f8f9fb",
            colorBgContainer: mode === "dark" ? "#171d2a" : "#ffffff",
            colorBorderSecondary:
              mode === "dark"
                ? "rgba(255, 255, 255, 0.09)"
                : "rgba(15, 23, 42, 0.08)",
            colorError: mode === "dark" ? "#ff7875" : "#cf1322",
            colorErrorText: mode === "dark" ? "#ff9c9c" : "#a8071a",
            colorSuccess: mode === "dark" ? "#86efac" : "#166534",
            colorSuccessBg: mode === "dark" ? "#132a1b" : "#f0fdf4",
            colorSuccessBorder: mode === "dark" ? "#166534" : "#86efac",
            colorSuccessText: mode === "dark" ? "#bbf7d0" : "#14532d",
            colorText: mode === "dark" ? "#f4f5f7" : "#212121",
            colorTextSecondary: mode === "dark" ? "#aeb6c3" : "#626b78",
            colorTextDescription: mode === "dark" ? "#aeb6c3" : "#626b78",
            colorTextPlaceholder: mode === "dark" ? "#aeb6c3" : "#626b78",
            // Loading buttons already expose a spinner and busy state. Keeping
            // them opaque prevents their primary label from losing contrast.
            opacityLoading: 1,
            fontFamily:
              '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
            borderRadius: 12,
            borderRadiusLG: 16,
            controlHeight: 36,
            fontSize: 15,
          },
          components: {
            Button: {
              contentFontSize: 14,
              contentFontSizeLG: 14,
              controlHeight: 32,
              controlHeightLG: 36,
              onlyIconSize: 16,
              onlyIconSizeLG: 17,
              paddingInline: 14,
              paddingInlineLG: 16,
              primaryShadow: "none",
            },
            Card: {
              headerBg: "transparent",
              headerHeight: 52,
              paddingLG: 20,
            },
            Descriptions: {
              labelColor: mode === "dark" ? "#aeb6c3" : "#626b78",
            },
            Layout: {
              bodyBg: mode === "dark" ? "#0f1420" : "#f8f9fb",
              headerBg: mode === "dark" ? "#171d2a" : "#ffffff",
              siderBg: mode === "dark" ? "#0f1420" : "#f8f9fb",
            },
            Menu: {
              groupTitleColor: mode === "dark" ? "#a5afbf" : "#5f6673",
              itemBg: "transparent",
              itemBorderRadius: 10,
              itemHeight: 40,
              itemHoverBg:
                mode === "dark" ? "rgba(129, 140, 248, 0.10)" : "#f5f6ff",
              itemHoverColor: mode === "dark" ? "#c7d2fe" : "#4f46e5",
              itemSelectedBg:
                mode === "dark" ? "rgba(129, 140, 248, 0.16)" : "#eef0ff",
              itemSelectedColor: mode === "dark" ? "#c7d2fe" : "#4f46e5",
            },
            Segmented: {
              itemSelectedBg: mode === "dark" ? "#252c3c" : "#ffffff",
              trackBg: mode === "dark" ? "#111827" : "#eef0f4",
            },
            Table: {
              headerBg: mode === "dark" ? "#202735" : "#f8f9fb",
              headerColor: mode === "dark" ? "#f4f5f7" : "#373b45",
              rowHoverBg:
                mode === "dark" ? "rgba(129, 140, 248, 0.08)" : "#fafaff",
            },
            Tabs: {
              inkBarColor: mode === "dark" ? "#818cf8" : "#4f46e5",
              itemActiveColor: mode === "dark" ? "#c7d2fe" : "#3730a3",
              itemHoverColor: mode === "dark" ? "#c7d2fe" : "#4338ca",
              itemSelectedColor: mode === "dark" ? "#a5b4fc" : "#4f46e5",
            },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
