'use client';
import { NavShell } from '../components/NavShell';
import { AlertasList } from './AlertasList';
import { EvolucaoChart } from './EvolucaoChart';
import { RankingTable } from './RankingTable';

export function DashboardClient() {
  return (
    <NavShell>
      <AlertasList />
      <EvolucaoChart />
      <RankingTable />
    </NavShell>
  );
}
