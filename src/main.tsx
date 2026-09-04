import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Home from '@/app/page';
import { AdminPortal } from '@/app/admin/portal';
import { ReportView } from '@/app/report/report-view';
import '@/app/globals.css';

function currentRoute() {
  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/admin') return 'admin';
  if (normalized === '/report') return 'report';
  return 'home';
}

function Application() {
  const route = currentRoute();
  if (route === 'admin') {
    document.title = 'LilyPlan · 管理后台';
    return <AdminPortal />;
  }
  if (route === 'report') {
    document.title = 'LilyPlan · 专属保险方案';
    return <ReportView />;
  }
  document.title = 'LilyPlan · 私人保障方案';
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Application />
  </StrictMode>,
);
