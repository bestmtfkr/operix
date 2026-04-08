// Role hierarchy: owner > admin > office > member
const ROLE_LEVELS = { owner: 4, admin: 3, office: 2, member: 1 }

export function canAccess(userRole, requiredRole) {
  return (ROLE_LEVELS[userRole] || 0) >= (ROLE_LEVELS[requiredRole] || 0)
}

// Module access rules
export const MODULE_ACCESS = {
  dashboard: 'member',      // Everyone sees dashboard
  jobs: 'member',           // Everyone sees jobs
  clients: 'office',        // Office+ sees clients
  billing: 'office',        // Office+ sees billing
  team: 'office',           // Office+ sees team management
  settings: 'owner',        // Only owner sees settings
  quotes: 'office',         // Office+ sees quotes
  time_tracking: 'member',  // Everyone can log time
  equipment: 'office',      // Office+ manages equipment
}

export function canAccessModule(userRole, module) {
  return canAccess(userRole, MODULE_ACCESS[module] || 'owner')
}
