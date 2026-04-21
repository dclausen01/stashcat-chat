/**
 * Barrel exports for all API modules.
 *
 * Import from `../api` to get everything, or import from a
 * specific sub-module (e.g. `../api/channels`) for tree-shaking.
 */

// Core
export {
  persistToken,
  restoreToken,
  clearSession,
  getToken,
  isLoggedIn,
  get,
  post,
  del,
  patch,
  put,
} from './core';

// Auth & Account
export {
  login,
  loginCredentials,
  loginFinalizeWithPassword,
  initiateDeviceKeyTransfer,
  loginFinalizeWithDeviceCode,
  logout,
  getMe,
  getCompanies,
  getAccountSettings,
  changeStatus,
  setOnlineStatus,
  deriveAvailability,
  uploadProfileImage,
  resetProfileImage,
} from './auth';
export type { AccountSettings } from './auth';

// Channels
export {
  getChannels,
  getChannelInfo,
  getChannelMembers,
  getPendingChannelMembers,
  inviteToChannel,
  removeFromChannel,
  addModerator,
  removeModerator,
  editChannel,
  setChannelImage,
  deleteChannel,
  createChannel,
  setFavorite,
  getVisibleChannels,
  joinChannel,
  acceptChannelInvite,
  declineChannelInvite,
  searchCompanyMembers,
  getCompanyGroups,
  getGroupMembers,
  setChannelNotifications,
} from './channels';
export type { ManagedUser, CompanyGroup } from './channels';

// Conversations
export {
  createConversation,
  getConversation,
  getConversations,
} from './conversations';

// Messages
export {
  getMessages,
  searchMessages,
  sendMessage,
  sendTyping,
  likeMessage,
  listLikes,
  unlikeMessage,
  deleteMessage,
  markAsRead,
  flagMessage,
  unflagMessage,
  getFlaggedMessages,
  startVideoMeeting,
  uploadFile,
} from './messages';
export type { LikeInfo } from './messages';

// Files & Storage
export {
  listFolder,
  listPersonalFiles,
  getFileQuota,
  deleteFile,
  deleteFiles,
  deleteFolder,
  renameFile,
  moveFile,
  createFolder,
  uploadToStorage,
  fileDownloadUrl,
  fileViewUrl,
  canViewInOnlyOffice,
  openInOnlyOffice,
  getLinkPreview,
} from './files';
export type { FolderContent, FileQuota, FileQuotaEntry, LinkPreview } from './files';

// Broadcasts
export {
  listBroadcasts,
  createBroadcast,
  deleteBroadcast,
  renameBroadcast,
  getBroadcastMessages,
  sendBroadcastMessage,
  getBroadcastMembers,
  addBroadcastMembers,
  removeBroadcastMembers,
} from './broadcasts';

// Calendar
export {
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  editCalendarEvent,
  deleteCalendarEvent,
  respondToCalendarEvent,
  getCalendarChannels,
} from './calendar';
export type { CalendarEvent } from './calendar';

// Notifications
export {
  getNotifications,
  getNotificationCount,
  deleteNotification,
  deleteAllNotifications,
  acceptKeySync,
} from './notifications';
export type { AppNotification } from './notifications';

// Calls (WebRTC Audio)
export {
  getTurnServer,
  createCall,
  sendCallSignal,
  endCall,
} from './calls';
export type { TurnServer, CallParty, CallInfo } from './calls';

// Polls
export {
  listPolls,
  getPoll,
  createPoll,
  deletePoll,
  archivePoll,
  closePoll,
  submitPollAnswer,
} from './polls';
export type { PollUser, PollAnswer, PollQuestion, Poll, CreatePollData } from './polls';
