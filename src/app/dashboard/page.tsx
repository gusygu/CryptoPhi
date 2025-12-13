import ArbitrageDashboard from "@/components/features/trading/ArbitrageDashboard";

export const metadata = {
  title: "Arbitrage Dashboard | CryptoPi",
};

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <ArbitrageDashboard />
    </div>
  );
}
