import { Suspense } from "react";
import CommunityClient from "./CommunityClient";

export default function CommunityPage() {
  return <Suspense fallback={<main style={{ padding: 24 }}>Loading ANPOS Community…</main>}>
    <CommunityClient />
  </Suspense>;
}
