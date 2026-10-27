import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/app-layout';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { NotFoundView } from './views/not-found/NotFoundView';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/design-system" replace />} />
        <Route path="/design-system" element={<DesignSystemView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
