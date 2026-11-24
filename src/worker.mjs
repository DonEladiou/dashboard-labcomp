import { createDashboardAPI } from './api.mjs';

const handle = createDashboardAPI();
export default { fetch(request, env) { return handle(request, env); } };
