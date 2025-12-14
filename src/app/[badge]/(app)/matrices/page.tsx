"use client";

import { Suspense } from "react";
import MatricesClient from "@/components/features/matrices/MatricesClient";

export default function MatricesBadgePage({ params }: { params: { badge: string } }) {
  return (
    <Suspense fallback={null}>
      <MatricesClient badge={params.badge} />
    </Suspense>
  );
}
