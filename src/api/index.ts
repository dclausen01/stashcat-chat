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
  mobileLogin,
  mobileSession,
  mobileLogout,
} from './auth';
export type { AccountSettings, MobileLoginResult } from './auth';

// Push (FCM token registry + mobile push prefs)
export {
  registerPushToken,
  unregisterPushToken,
  listOwnPushTokens,
  getMobilePushPreview,
  setMobilePushPreview,
} from './push';
export type { Platform as PushPlatform, PushPreviewMode, PushToken } from './push';

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
  quitChannel,
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
  archiveConversation,
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
  markChatAsUnread,
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
  uploadBroadcastFile,
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

// Nextcloud
export {
  ncGetStoredAppPassword,
  ncSetStoredAppPassword,
  ncClearStoredAppPassword,
  ncGetUsernameOverride,
  ncSetUsernameOverride,
  ncClearUsernameOverride,
  ncStatus,
  ncProbeAndDetect,
  ncList,
  ncUpload,
  ncDelete,
  ncRename,
  ncMove,
  ncMkcol,
  ncShare,
  ncQuota,
  ncDownloadUrl,
  ncViewUrl,
  ncSetCredentials,
  ncOpenInOnlyOffice,
} from './nextcloud';
export type { NCEntry, NCQuota, NCStatus } from './nextcloud';

// Public runtime config
export { getPublicConfig } from './config';
export type { PublicConfig } from './config';
