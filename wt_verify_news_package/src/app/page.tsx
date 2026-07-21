import React from 'react';
import LeftNav from '../components/atlas/LeftNav';
import AtlasHeader from '../components/atlas/AtlasHeader';
import PortfolioSummary from '../components/atlas/PortfolioSummary';
import PortfolioAnalysis from '../components/atlas/PortfolioAnalysis';
import DailySimulationWrapper from '../components/atlas/DailySimulationWrapper';
import HoldingsTable from '../components/atlas/HoldingsTable';
import RecentTrades from '../components/atlas/RecentTrades';
import CoachBriefing from '../components/atlas/CoachBriefing';
import RiskOverview from '../components/atlas/RiskOverview';
import InvestorProfilePanel from '../components/atlas/InvestorProfilePanel';

export default function Page() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F5EFE6]">
      <LeftNav />
      <div className="ml-[250px] h-full flex flex-col">
        <div className="p-6 overflow-auto">
          <main className="max-w-[1400px] mx-auto">
            <AtlasHeader />

            <section className="grid grid-cols-3 gap-6 mt-6">
              <div className="col-span-2 space-y-4">
                <DailySimulationWrapper />
                <PortfolioAnalysis />
                <PortfolioSummary />
                <HoldingsTable />
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
