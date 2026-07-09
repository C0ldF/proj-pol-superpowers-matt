'use client';
import { NavShell } from '../components/NavShell';
import { AlertasList } from './AlertasList';
import { EvolucaoChart } from './EvolucaoChart';
import { RankingTable } from './RankingTable';

export function DashboardClient() {
  return (
    <NavShell>
      <div className="flex flex-col gap-6">
        <AlertasList />
        <EvolucaoChart />
        <RankingTable />
      </div>
    </NavShell>
  );
}
