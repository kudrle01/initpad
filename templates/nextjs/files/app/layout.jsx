export const metadata = { title: 'InitPad app' };

const css = 'body{margin:0;font-family:system-ui,sans-serif}.app{padding:3rem;text-align:center}';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
