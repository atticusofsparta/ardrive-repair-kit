import { Outlet } from 'react-router-dom';

import Notifications from './Notifications';

function AppRouterLayout() {
  return (
    <div className="flex size-full bg-background">
      <Outlet />
      <Notifications />
    </div>
  );
}

export default AppRouterLayout;
