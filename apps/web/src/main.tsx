import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/auth';
import { ToastProvider } from '@/toast';
import App from '@/App';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import VerifyEmail from '@/pages/VerifyEmail';
import Activate from '@/pages/Activate';
import Dashboard from '@/pages/Dashboard';
import Projects from '@/pages/Projects';
import Templates from '@/pages/Templates';
import Environments from '@/pages/Environments';
import Activity from '@/pages/Activity';
import Infrastructure from '@/pages/Infrastructure';
import Settings from '@/pages/Settings';
import Admin from '@/pages/Admin';
import NewProject from '@/pages/NewProject';
import ImportRepo from '@/pages/ImportRepo';
import ProjectDetail from '@/pages/ProjectDetail';
import ProjectDeployments from '@/pages/ProjectDeployments';
import ProjectCommits from '@/pages/ProjectCommits';
import NotFound from '@/pages/NotFound';
import RouteError from '@/pages/RouteError';
import '@/index.css';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password/:token', element: <ResetPassword /> },
  { path: '/verify-email/:token', element: <VerifyEmail /> },
  { path: '/activate/:token', element: <Activate /> },
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'projects', element: <Projects /> },
      { path: 'templates', element: <Templates /> },
      { path: 'environments', element: <Environments /> },
      { path: 'activity', element: <Activity /> },
      { path: 'infrastructure', element: <Infrastructure /> },
      { path: 'settings', element: <Settings /> },
      { path: 'admin', element: <Admin /> },
      { path: 'new', element: <NewProject /> },
      { path: 'import', element: <ImportRepo /> },
      { path: 'projects/:id/deployments', element: <ProjectDeployments /> },
      { path: 'projects/:id/commits', element: <ProjectCommits /> },
      { path: 'projects/:id', element: <ProjectDetail /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
);
