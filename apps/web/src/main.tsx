import React, { lazy, Suspense, type ComponentType } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/auth';
import { ToastProvider } from '@/toast';
import { ConfirmationProvider } from '@/confirmation';
import App from '@/App';
import RouteError from '@/pages/RouteError';
import { RouteLoading } from '@/components/molecules/RouteLoading';
import '@/index.css';

const Login = lazy(() => import('@/pages/Login'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const VerifyEmail = lazy(() => import('@/pages/VerifyEmail'));
const Activate = lazy(() => import('@/pages/Activate'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Projects = lazy(() => import('@/pages/Projects'));
const Templates = lazy(() => import('@/pages/Templates'));
const Environments = lazy(() => import('@/pages/Environments'));
const Activity = lazy(() => import('@/pages/Activity'));
const AuditLog = lazy(() => import('@/pages/AuditLog'));
const Infrastructure = lazy(() => import('@/pages/Infrastructure'));
const AccountSettings = lazy(() => import('@/pages/AccountSettings'));
const WorkspaceSettings = lazy(() => import('@/pages/WorkspaceSettings'));
const Admin = lazy(() => import('@/pages/Admin'));
const NewProject = lazy(() => import('@/pages/NewProject'));
const ImportRepo = lazy(() => import('@/pages/ImportRepo'));
const ProjectDetail = lazy(() => import('@/pages/ProjectDetail'));
const ProjectDeployments = lazy(() => import('@/pages/ProjectDeployments'));
const ProjectCommits = lazy(() => import('@/pages/ProjectCommits'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function page(Page: ComponentType) {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Page />
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: page(Login) },
  { path: '/forgot-password', element: page(ForgotPassword) },
  { path: '/reset-password/:token', element: page(ResetPassword) },
  { path: '/verify-email/:token', element: page(VerifyEmail) },
  { path: '/activate/:token', element: page(Activate) },
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(Dashboard) },
      { path: 'projects', element: page(Projects) },
      { path: 'templates', element: page(Templates) },
      { path: 'environments', element: page(Environments) },
      { path: 'activity', element: page(Activity) },
      { path: 'audit', element: page(AuditLog) },
      { path: 'infrastructure', element: page(Infrastructure) },
      { path: 'settings', element: <Navigate to="/settings/account" replace /> },
      { path: 'settings/account', element: page(AccountSettings) },
      { path: 'settings/workspace', element: page(WorkspaceSettings) },
      { path: 'admin', element: page(Admin) },
      { path: 'new', element: page(NewProject) },
      { path: 'import', element: page(ImportRepo) },
      { path: 'projects/:id/deployments', element: page(ProjectDeployments) },
      { path: 'projects/:id/commits', element: page(ProjectCommits) },
      { path: 'projects/:id', element: page(ProjectDetail) },
      { path: '*', element: page(NotFound) },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmationProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ConfirmationProvider>
    </ToastProvider>
  </React.StrictMode>,
);
