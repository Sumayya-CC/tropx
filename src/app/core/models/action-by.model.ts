/**
 * WHY: The ActionBy interface is used for the "snapshot pattern."
 * Instead of storing just a UID or linking to a user document, we snapshot 
 * the user's name and UID at the time the action occurred. This ensures 
 * that historical records (e.g., "who created this order") remain accurate 
 * even if the user's name changes or the user is isDeleted in the future.
 */
export interface ActionBy {
  uid: string;
  firstName: string;
  lastName: string;
}

