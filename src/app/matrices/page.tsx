"use client";

import { Suspense } from "react";

import MatricesClient from "@/components/features/matrices/MatricesClient";

export default function MatricesPage() {
  return (
    <Suspense fallback={null}>
      <MatricesClient />
    </Suspense>
  );
}
