"use client";

import { MoonFilled, SunFilled } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useThemeMode } from "./providers";

export function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  return (
    <Tooltip title={mode === "dark" ? "切换到亮色模式" : "切换到暗色模式"}>
      <Button
        type="text"
        shape="circle"
        size="large"
        onClick={toggle}
        icon={mode === "dark" ? <SunFilled /> : <MoonFilled />}
        aria-label="切换亮暗色模式"
      />
    </Tooltip>
  );
}
