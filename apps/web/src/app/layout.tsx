import "@ant-design/v5-patch-for-react-19";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "antd/dist/reset.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AnswerBit GEO · AI 品牌增长情报",
  description: "企业级生成式搜索优化与品牌情报工作台",
};

const themeInitScript = `(function(){try{var m=localStorage.getItem("ab-theme");if(m!=="light"&&m!=="dark")m="light";document.documentElement.dataset.theme=m;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("X-Nonce") ?? undefined;
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
