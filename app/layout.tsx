import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Escáner de preparación para IA",
  description: "Informe técnico y de visibilidad en IA para tiendas PrestaShop",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
