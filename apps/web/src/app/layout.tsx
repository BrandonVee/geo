import "@ant-design/v5-patch-for-react-19";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "antd/dist/reset.css";
import "./globals.css";
import { Providers } from "./providers";
import { StyleRegistry } from "./style-registry";

export const metadata: Metadata = {
  title: "AnswerBit GEO · AI 品牌增长情报",
  description: "企业级生成式搜索优化与品牌情报工作台",
};

const themeInitScript = `(function(){try{var m=localStorage.getItem("ab-theme");if(m!=="light"&&m!=="dark")m="light";document.documentElement.dataset.theme=m;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("X-Nonce") ?? undefined;
  const insertServerStyles = requestHeaders.get("RSC") !== "1";
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        <StyleRegistry nonce={nonce} insertServerStyles={insertServerStyles}>
          <Providers nonce={nonce}>{children}</Providers>
        </StyleRegistry>
      </body>
    </html>
  );
}
