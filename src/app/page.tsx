import React from 'react';
import LeftSidebar from '../components/dashboard-v1/LeftSidebar';
import AtlasHeader from '../components/atlas/AtlasHeader';
import PortfolioSummary from '../components/atlas/PortfolioSummary';
import PortfolioAnalysis from '../components/atlas/PortfolioAnalysis';
import DailySimulationWrapper from '../components/atlas/DailySimulationWrapper';
import HoldingsTable from '../components/atlas/HoldingsTable';
import RecentTrades from '../components/atlas/RecentTrades';
import CoachBriefing from '../components/atlas/CoachBriefing';
import RiskOverview from '../components/atlas/RiskOverview';
import InvestorProfilePanel from '../components/atlas/InvestorProfilePanel';
import { getPortfolio } from '../domain/portfolio/portfolio-service';

export default function Page() {
  // Server-side: obtain the canonical initial portfolio and pass to client component
  const initialPortfolio = getPortfolio();
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F5EFE6]">
      <LeftSidebar />
      <div className="ml-[240px] h-full flex flex-col">
        <div className="p-6 overflow-auto">
          <main className="max-w-[1400px] mx-auto">
            <AtlasHeader />

            <section className="grid grid-cols-3 gap-6 mt-6">
              <div className="col-span-2 space-y-4">
                <DailySimulationWrapper />
                <PortfolioAnalysis />
                <PortfolioSummary />
                <HoldingsTable initialPortfolio={initialPortfolio} />
                <RecentTrades />
              </div>

              <aside className="space-y-4">
                <CoachBriefing />
                <InvestorProfilePanel />
                <RiskOverview />
              </aside>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
