import type { ReactNode } from "react";

export const metadata = {
  title: "ANPOS Commercial Service",
  description: "GitHub Marketplace entitlement and provisioning service for ANPOS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{fontFamily:"system-ui,sans-serif",maxWidth:900,margin:"48px auto",padding:"0 24px"}}>{children}</body></html>;
}
