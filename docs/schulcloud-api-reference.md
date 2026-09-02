# schul.cloud / Stashcat — vollständige API-Referenz

Automatisch extrahiert aus dem offiziellen Angular-Webclient (`app.schul.cloud`,
`main` + alle Lazy-Chunks) durch statische Analyse der `doRequest(...)`-Aufrufe und
der zugehörigen `buildURLSearchParams({...})`-Objekte.

- Transport: `POST`, `application/x-www-form-urlencoded`, Basis-URL `https://api.schul.cloud`
- Jeder Request trägt zusätzlich `client_key` und `device_id` (hier weggelassen).
- Antwort: `{ status: {...}, payload: {...} }`
- Spalte **Status**: ✅ = in `stashcat-api` oder `server/` bereits verdrahtet, ⬜ = noch offen.

## `/manage/*` — 72 Endpunkte (70 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/manage/accounts` | `company_id` |
| ⬜ | `/manage/activate_marketplace_module` | `company_id`, `module_id` |
| ⬜ | `/manage/activate_user_memberships` | `company_id`, `user_ids` |
| ⬜ | `/manage/add_company_connection` | `company_id`, `foreign_company_id` |
| ⬜ | `/manage/add_federation_server` | `company_id`, `server_url` |
| ⬜ | `/manage/add_user` | `first_name`, `last_name`, `email`, `company_id`, `administrator`, `read_only`, `roles` |
| ⬜ | `/manage/add_users` | `company_id`, `limit_group_communication`, `users`, `last_name`, `email`, `role_id`, `groups`, `tag`, `attributes`, `value` |
| ⬜ | `/manage/add_users_to_group` | `company_id`, `group_id`, `users` |
| ⬜ | `/manage/assign_communicationlimits_groups` | `company_id`, `group_id`, `communication_groups` |
| ⬜ | `/manage/assign_roles` | `user_ids`, `role_ids`, `company_id` |
| ⬜ | `/manage/create_channel` | `company_id`, `channel_name`, `password`, `password_repeat`, `description`, `type`, `visible`, `writable`, `inviteable`, `show_membership_activities`, `can_leave` |
| ⬜ | `/manage/create_company_user_attribute` | `company_id`, `name`, `is_visible` |
| ⬜ | `/manage/create_group` | `company_id`, `name`, `description`, `create_channel`, `limit_communication` |
| ⬜ | `/manage/create_status` | `company_id`, `name`, `notifications` |
| ⬜ | `/manage/deactivate_marketplace_module` | `company_id`, `module_id` |
| ⬜ | `/manage/deactivate_user_memberships` | `company_id`, `user_ids` |
| ⬜ | `/manage/delete_channel` | `company_id`, `channel_id` |
| ⬜ | `/manage/delete_company_connection` | `company_id`, `foreign_company_id` |
| ⬜ | `/manage/delete_company_user_attribute` | `company_id`, `company_user_attribute_id` |
| ⬜ | `/manage/delete_group` | `company_id`, `group_id` |
| ⬜ | `/manage/delete_status` | `company_id`, `status_id` |
| ⬜ | `/manage/delete_user` | `company_id`, `user_id` |
| ⬜ | `/manage/delete_users` | `company_id`, `user_ids` |
| ⬜ | `/manage/demote_from_server_admin` | `user_id` |
| ⬜ | `/manage/demote_user` | `company_id`, `user_id` |
| ⬜ | `/manage/edit_channel` | `company_id`, `channel_id`, `channel_name`, `description`, `writable`, `visible`, `password`, `password_repeat`, `inviteable`, `type`, `show_activities`, `show_membership_activities`, `message_ttl` |
| ⬜ | `/manage/edit_company_user_attribute` | `company_id`, `company_user_attribute_id`, `name`, `is_visible` |
| ⬜ | `/manage/edit_group` | `company_id`, `group_id`, `name`, `description`, `create_channel`, `limit_communication` |
| ⬜ | `/manage/edit_user` | `first_name`, `last_name`, `user_id`, `company_id`, `roles` |
| ⬜ | `/manage/get_channel_count` | `company_id` |
| ⬜ | `/manage/get_channel_statistics` | `company_id`, `channel_id` |
| ⬜ | `/manage/get_company_market` | `company_id` |
| ⬜ | `/manage/get_marketplace_module_texts` | `company_id`, `module_id`, `language` |
| ⬜ | `/manage/get_sharelink_details` | `share_link` |
| ⬜ | `/manage/get_user` | `company_id`, `user_id` |
| ⬜ | `/manage/get_users_permissions` | `company_id` |
| ⬜ | `/manage/import_status` | `hash` |
| ⬜ | `/manage/list_auditlog` | `time_from`, `time_to`, `category`, `sorting`, `offset`, `limit` |
| ⬜ | `/manage/list_available_licenses` | `company_id` |
| ⬜ | `/manage/list_channel_members` | `company_id`, `channel_id`, `limit`, `offset`, `filter`, `sorting`, `search` |
| ⬜ | `/manage/list_channels` | `company_id`, `offset`, `limit`, `search`, `sorting`, `visible`, `type`, `exclude_ids` |
| ⬜ | `/manage/list_communicationlimits_groups` | `company_id`, `group_id` |
| ⬜ | `/manage/list_companies` | _—_ |
| ⬜ | `/manage/list_company_user_attributes` | `company_id` |
| ⬜ | `/manage/list_connected_companies` | `company_id` |
| ⬜ | `/manage/list_devices_by_users` | `company_id`, `user_id` |
| ⬜ | `/manage/list_federation_servers` | `company_id` |
| ✅ | `/manage/list_groups` | `company_id`, `search`, `sorting`, `limit`, `offset`, `create_channels`, `limit_communication` |
| ⬜ | `/manage/list_groups_by_users` | `company_id`, `user_ids`, `ids_only`, `search`, `sorting`, `limit`, `offset` |
| ⬜ | `/manage/list_marketplace_modules` | `company_id`, `language` |
| ⬜ | `/manage/list_user_attributes` | `company_id`, `user_id` |
| ✅ | `/manage/list_users` | `company_id`, `limit`, `offset`, `search`, `sorting`, `status`, `roles`, `expiry_set`, `group_ids`, `exclude_user_ids`, `withkey`, `not_member_of_any_group` |
| ⬜ | `/manage/list_users_by_group` | `company_id`, `group_id`, `search`, `sorting`, `limit`, `offset` |
| ⬜ | `/manage/match_users` | `company_id`, `users`, `first_name`, `last_name`, `email`, `groups`, `tag`, `attributes`, `value`, `match_by`, `match_role_id` |
| ⬜ | `/manage/promote_to_server_admin` | `user_id` |
| ⬜ | `/manage/promote_user` | `company_id`, `user_id` |
| ⬜ | `/manage/remove_all_devices_by_user` | `company_id`, `user_id` |
| ⬜ | `/manage/remove_channel_moderator_status` | `company_id`, `channel_id`, `user_ids` |
| ⬜ | `/manage/remove_device` | `company_id`, `user_id`, `deviceID` |
| ⬜ | `/manage/remove_federation_server` | `company_id`, `server_url` |
| ⬜ | `/manage/remove_users_from_group` | `company_id`, `group_id`, `users` |
| ⬜ | `/manage/send_email_invite` | `user_id`, `email` |
| ⬜ | `/manage/set_channel_image` | `company_id`, `channel_id`, `imgBase64` |
| ⬜ | `/manage/set_channel_moderator_status` | `company_id`, `channel_id`, `user_ids` |
| ⬜ | `/manage/set_channels_visibility` | `company_id`, `channel_ids`, `visible` |
| ⬜ | `/manage/set_company_license` | `company_id`, `license` |
| ⬜ | `/manage/set_company_market` | `company_id`, `market`, `market_other` |
| ⬜ | `/manage/set_read_only` | `company_id`, `user_id`, `read_only` |
| ⬜ | `/manage/set_user_attribute_value` | `company_id`, `company_user_attribute_id`, `user_id`, `value` |
| ⬜ | `/manage/set_user_company_membership_expiry` | `company_id`, `user_ids`, `expiry` |
| ⬜ | `/manage/set_user_company_membership_tags` | `company_id`, `user_ids_tags` |
| ⬜ | `/manage/set_users_attributes_values` | `company_id`, `users_attributes_values` |

## `/permissions/*` — 6 Endpunkte (6 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/permissions/add_users` | `users`, `role_id` |
| ⬜ | `/permissions/create` | `company_id`, `name`, `permissions`, `isGlobal` |
| ⬜ | `/permissions/delete` | `company_id`, `role_id` |
| ⬜ | `/permissions/edit` | `company_id`, `name`, `permissions`, `isGlobal`, `role_id` |
| ⬜ | `/permissions/get` | `company_id` |
| ⬜ | `/permissions/remove_users` | `users`, `role_id` |

## `/users/*` — 12 Endpunkte (10 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/users/available_roles` | `company_id` |
| ⬜ | `/users/create_register_link` | `company_id`, `role_id`, `expiry`, `count`, `company_membership_expiry` |
| ⬜ | `/users/delete_register_link` | `company_id`, `link_id` |
| ⬜ | `/users/grouped` | `company`, `type` |
| ✅ | `/users/info` | `user_id`, `withkey` |
| ⬜ | `/users/infos` | `user_ids`, `withkey` |
| ⬜ | `/users/list_online_users` | `user_ids` |
| ⬜ | `/users/list_register_link` | `company_id` |
| ⬜ | `/users/list_register_link_users` | `company_id`, `invite_link_id`, `invite_link_token` |
| ⬜ | `/users/list_user_attributes` | `user_id` |
| ⬜ | `/users/listing` | `company`, `limit`, `offset`, `key_hashes`, `search`, `sorting`, `exclude_user_ids`, `group_ids`, `fields`, `status` |
| ✅ | `/users/me` | `withkey` |

## `/groups/*` — 2 Endpunkte (2 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/groups/get_company_groups` | `company`, `search`, `sorting` |
| ⬜ | `/groups/list_members` | `group_id`, `limit`, `offset`, `search`, `sorting` |

## `/tags/*` — 2 Endpunkte (2 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/tags/create` | `tag_name` |
| ⬜ | `/tags/listing` | _—_ |

## `/server/*` — 14 Endpunkte (14 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/server/add_backup` | `type`, `description`, `minute`, `hour`, `day`, `month`, `weekday`, `target`, `target_protocol`, `target_server`, `target_port`, `target_username`, `target_password`, `target_domain`, `filename`, `max_keep_old_backups` |
| ⬜ | `/server/add_company` | `name`, `manager_id`, `quota`, `max_users`, `online_payment`, `freemium`, `logo`, `domain` |
| ⬜ | `/server/analytics` | `company_id`, `timespan`, `begin`, `end` |
| ⬜ | `/server/assign_company_features` | `company_id`, `company_features` |
| ⬜ | `/server/change_company_image` | `company_id`, `logo` |
| ⬜ | `/server/delete_backup` | `backup_id` |
| ⬜ | `/server/delete_company` | `company_id` |
| ⬜ | `/server/edit_backup` | `backup_id`, `type`, `description`, `minute`, `hour`, `day`, `month`, `weekday`, `target`, `target_protocol`, `target_server`, `target_port`, `target_username`, `target_password`, `target_domain`, `filename`, `max_keep_old_backups` |
| ⬜ | `/server/edit_company` | `company_id`, `manager_id`, `name`, `quota`, `max_users`, `online_payment`, `freemium`, `domain` |
| ⬜ | `/server/get_email_templates` | `company_id` |
| ⬜ | `/server/list_backup` | _—_ |
| ⬜ | `/server/list_company_features` | `company_id` |
| ⬜ | `/server/restore_email_template` | `company_id`, `name` |
| ⬜ | `/server/store_email_template` | `company_id`, `name`, `content` |

## `/connections/*` — 7 Endpunkte (7 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/connections/activateserver` | `company_id`, `server_id` |
| ⬜ | `/connections/add` | `company_id`, `host`, `port`, `read_user_name`, `read_password`, `type`, `dc`, `ldap_groups_settings`, `group_dc`, `group_filter`, `mandatory_group`, `group_roles`, `encrypt_channels`, `use_filter_on_user_groups`, `use_description_as_name`, `filter_all_users`, `filter_specific_user`, `user_marked_for_deletion_attribute_name`, `user_marked_for_deletion_attribute_type`, `schema`, `attribute_group_name`, `user_delete_method`, `filter_mail_attribute`, `attribute_mapping`, `attribute_name_global_identifier`, `attribute_group_name_for_groups_and_channels` |
| ⬜ | `/connections/deactivateserver` | `company_id`, `server_id` |
| ⬜ | `/connections/delete` | `company_id`, `server_id` |
| ⬜ | `/connections/edit` | `company_id`, `server_id`, `server`, `port`, `read_user_name`, `read_password`, `type`, `dc`, `ldap_groups_settings`, `group_dc`, `group_filter`, `mandatory_group`, `group_roles`, `encrypt_channels`, `use_filter_on_user_groups`, `use_description_as_name`, `filter_all_users`, `filter_specific_user`, `user_marked_for_deletion_attribute_name`, `user_marked_for_deletion_attribute_type`, `schema`, `attribute_group_name`, `user_delete_method`, `filter_mail_attribute`, `attribute_mapping`, `attribute_name_global_identifier`, `attribute_group_name_for_groups_and_channels` |
| ⬜ | `/connections/servers` | `company_id` |
| ⬜ | `/connections/simulate_login` | `company_id`, `server_id`, `email` |

## `/channels/*` — 12 Endpunkte (4 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/channels/create` | `unique_identifier`, `channel_name`, `company`, `password`, `password_repeat`, `description`, `type`, `visible`, `writable`, `encryption_key`, `encryption_key_signature`, `inviteable`, `show_activities`, `show_membership_activities`, `crypto_properties`, `mx_room_identifier`, `disclaimer`, `message_ttl` |
| ✅ | `/channels/delete` | `channel_id` |
| ✅ | `/channels/edit` | `channel_id`, `company_id`, `channel_name`, `description`, `writable`, `visible`, `inviteable`, `password`, `password_repeat`, `show_activities`, `show_membership_activities`, `mx_room_identifier`, `disclaimer`, `message_ttl` |
| ⬜ | `/channels/infos` | `company`, `timestamp`, `offset`, `limit`, `sorting` |
| ✅ | `/channels/join` | `channel_id`, `password` |
| ⬜ | `/channels/list_invites` | `company_id`, `limit`, `offset` |
| ✅ | `/channels/members` | `channel_id`, `limit`, `offset`, `sorting`, `filter`, `search`, `fields` |
| ✅ | `/channels/quit` | `channel_id` |
| ⬜ | `/channels/recommendations` | `company` |
| ⬜ | `/channels/rename` | `channel_id`, `channel_name` |
| ✅ | `/channels/subscripted` | `company`, `timestamp`, `offset`, `limit`, `sorting` |
| ✅ | `/channels/visible` | `company`, `limit`, `offset`, `search` |

## `/message/*` — 21 Endpunkte (7 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/message/cancel_live_location` | `message_id` |
| ✅ | `/message/content` | `conversation_id`, `channel_id`, `source`, `before_timestamp`, `timestamp`, `limit`, `offset`, `order_by_timestamp`, `preview`, `fields`, `only_messages_having_files` |
| ✅ | `/message/conversation` | `conversation_id` |
| ✅ | `/message/conversations` | `limit`, `offset`, `archive`, `timestamp`, `sorting` |
| ✅ | `/message/delete` | `message_id` |
| ✅ | `/message/flag` | `message_id` |
| ⬜ | `/message/get_message_seen_users_count` | `message_id` |
| ⬜ | `/message/hash` | `hash` |
| ⬜ | `/message/infos` | `message_ids`, `fields` |
| ✅ | `/message/like` | `message_id` |
| ✅ | `/message/list_chat_members_not_having_keys` | `type`, `type_id` |
| ✅ | `/message/list_flagged_messages` | `type`, `type_id`, `offset`, `limit` |
| ✅ | `/message/list_likes` | `message_id`, `offset`, `limit` |
| ⬜ | `/message/list_message_seen_users` | `message_id`, `offset`, `limit` |
| ✅ | `/message/mark_chat_as_unread` | `chat_type`, `chat_id` |
| ✅ | `/message/send` | `target`, `channel_id`, `conversation_id`, `text`, `files`, `url`, `longitude`, `latitude`, `encrypted`, `iv`, `verification`, `type`, `reply_to`, `is_forwarded`, `metainfo` |
| ✅ | `/message/set_favorite` | `channel_id`, `conversation_id`, `favorite` |
| ✅ | `/message/unflag` | `message_id` |
| ✅ | `/message/unlike` | `message_id` |
| ⬜ | `/message/update_live_location` | `longitude`, `latitude`, `message_id` |
| ⬜ | `/message/users_locations` | `conversation_id`, `channel_id` |

## `/chats/*` — 4 Endpunkte (4 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/chats/broadcasts` | _—_ |
| ⬜ | `/chats/messages` | _—_ |
| ⬜ | `/chats/messages/channel` | _—_ |
| ⬜ | `/chats/messages/conversation` | _—_ |

## `/poll/*` — 21 Endpunkte (0 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/poll/archive` | `poll_id`, `archive` |
| ✅ | `/poll/create` | `company_id`, `name`, `description`, `hidden_results`, `privacy_type`, `start_time`, `end_time` |
| ✅ | `/poll/create_answer` | `company_id`, `question_id`, `type`, `allday`, `start_time`, `end_time`, `answer_text`, `answer_limit`, `position` |
| ✅ | `/poll/create_question` | `company_id`, `poll_id`, `name`, `type`, `answer_limit`, `position` |
| ✅ | `/poll/delete` | `poll_id` |
| ✅ | `/poll/delete_answer` | `company_id`, `answer_id` |
| ✅ | `/poll/delete_question` | `company_id`, `question_id` |
| ✅ | `/poll/details` | `poll_id`, `company_id` |
| ✅ | `/poll/edit` | `company_id`, `poll_id`, `name`, `description`, `hidden_results`, `privacy_type`, `start_time`, `end_time` |
| ✅ | `/poll/edit_answer` | `company_id`, `answer_id`, `allday`, `start_time`, `end_time`, `answer_text`, `answer_limit`, `position` |
| ✅ | `/poll/edit_question` | `company_id`, `question_id`, `name`, `answer_limit`, `position` |
| ✅ | `/poll/export` | _—_ |
| ✅ | `/poll/invite` | `company_id`, `poll_id`, `invite_to`, `invite_ids` |
| ✅ | `/poll/list` | `constraint`, `company_id` |
| ✅ | `/poll/list_answers` | `question_id` |
| ✅ | `/poll/list_invited_users` | `poll_id` |
| ✅ | `/poll/list_invites` | `poll_id`, `type`, `offset`, `limit` |
| ✅ | `/poll/list_participants` | `poll_id` |
| ✅ | `/poll/publish` | `poll_id`, `watch` |
| ✅ | `/poll/store_user_answers` | `question_id`, `answer_ids` |
| ✅ | `/poll/watch` | `poll_id`, `watch` |

## `/events/*` — 9 Endpunkte (0 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/events/create` | `start`, `end`, `name`, `location`, `description`, `type`, `type_id`, `company_id`, `allday`, `no_notification`, `repeat`, `repeat_end`, `invite_user_ids`, `invite_channel_ids`, `created_dst` |
| ✅ | `/events/delete` | `event_ids` |
| ✅ | `/events/details` | `event_ids` |
| ✅ | `/events/edit` | `event_id`, `start`, `end`, `name`, `location`, `description`, `type`, `type_id`, `company_id`, `allday`, `no_notification`, `repeat`, `repeat_end`, `invite_user_ids`, `invite_channel_ids`, `created_dst` |
| ✅ | `/events/invite` | `user_ids`, `event_id` |
| ✅ | `/events/list` | `start`, `end` |
| ✅ | `/events/list_available_calendars` | _—_ |
| ✅ | `/events/list_channels_having_events` | `company_id` |
| ✅ | `/events/respond` | `event_id`, `user_id`, `status` |

## `/calendar/*` — 1 Endpunkte (1 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/calendar/monthly` | _—_ |

## `/file/*` — 11 Endpunkte (3 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/file/copy` | `file_id`, `folder_id`, `type`, `type_id` |
| ✅ | `/file/create_upload_context` | _—_ |
| ✅ | `/file/delete` | `file_ids` |
| ✅ | `/file/info` | `file_id` |
| ✅ | `/file/infos` | `file_ids`, `fields` |
| ⬜ | `/file/keys` | `file_id` |
| ✅ | `/file/move` | `file_id`, `parent_id` |
| ✅ | `/file/quota` | `type`, `type_id` |
| ✅ | `/file/rename` | `file_id`, `name` |
| ⬜ | `/file/shares` | `file_id` |
| ⬜ | `/file/upload_chunk` | _—_ |

## `/folder/*` — 9 Endpunkte (5 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/folder/create` | `folder_name`, `parent_id`, `type_id`, `type` |
| ✅ | `/folder/delete` | `folder_id` |
| ⬜ | `/folder/delete_sync` | `folder_id`, `sync_id` |
| ✅ | `/folder/get` | `folder_id`, `type`, `type_id`, `folder_only`, `offset`, `limit`, `search`, `sorting`, `fields`, `timestamp`, `before_timestamp` |
| ⬜ | `/folder/info` | `folder_id`, `type_id` |
| ⬜ | `/folder/list_uploaded_files` | `type`, `search`, `offset`, `limit`, `sorting`, `timestamp`, `before_timestamp` |
| ⬜ | `/folder/move` | `folder_id`, `parent_id` |
| ✅ | `/folder/rename` | `folder_id`, `name` |
| ⬜ | `/folder/set_sync_status` | `folder_id`, `path` |

## `/share/*` — 5 Endpunkte (5 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/share/create` | `file_id`, `folder_id`, `password` |
| ⬜ | `/share/delete` | `file_id`, `folder_id` |
| ⬜ | `/share/get` | `file_id`, `folder_id` |
| ⬜ | `/share/reactivate` | `file_id`, `folder_id` |
| ⬜ | `/share/revoke` | `file_id`, `folder_id` |

## `/search/*` — 4 Endpunkte (3 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/search/conversations` | `searchtag` |
| ⬜ | `/search/files` | `searchtag`, `folder_id`, `type`, `type_id` |
| ⬜ | `/search/folders` | `searchtag`, `folder_id`, `type`, `type_id` |
| ✅ | `/search/messages` | `start_time`, `end_time`, `channel_id`, `conversation_id`, `offset`, `limit` |

## `/broadcast/*` — 9 Endpunkte (0 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/broadcast/add` | `list_id`, `members` |
| ✅ | `/broadcast/content` | `list_id`, `offset`, `limit`, `timestamp`, `before_timestamp`, `fields`, `only_messages_having_files` |
| ✅ | `/broadcast/create` | `name`, `members` |
| ✅ | `/broadcast/delete` | `list_id` |
| ✅ | `/broadcast/list` | _—_ |
| ✅ | `/broadcast/list_members` | `list_id`, `sorting` |
| ✅ | `/broadcast/remove` | `list_id`, `members` |
| ✅ | `/broadcast/rename` | `list_id`, `name` |
| ✅ | `/broadcast/send` | `list_id`, `text`, `files`, `metainfo` |

## `/call/*` — 7 Endpunkte (5 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/call/create` | `type`, `target`, `target_id`, `callee_id`, `verification` |
| ⬜ | `/call/get` | `call_id` |
| ✅ | `/call/get_turn_server` | _—_ |
| ⬜ | `/call/list_callable_users` | `target`, `target_id` |
| ⬜ | `/call/ping` | `call_id` |
| ⬜ | `/call/react` | `call_id`, `reaction` |
| ⬜ | `/call/set_status` | `call_id`, `status` |

## `/conference/*` — 2 Endpunkte (2 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/conference/create` | `chat_id`, `chat_type`, `name`, `encryption_type`, `encrypted_encryption_key`, `encrypted_encryption_key_iv` |
| ⬜ | `/conference/invite` | `room_id`, `user_ids`, `emails` |

## `/collaboard/*` — 4 Endpunkte (4 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/collaboard/create` | `channel_id`, `link`, `name` |
| ⬜ | `/collaboard/delete` | `collaboard_link_id` |
| ⬜ | `/collaboard/edit` | `collaboard_link_id`, `name` |
| ⬜ | `/collaboard/list` | `channel_id` |

## `/account/*` — 18 Endpunkte (11 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/account/change_email` | `email` |
| ✅ | `/account/change_password` | `new_password`, `old_password` |
| ✅ | `/account/change_status` | `status` |
| ✅ | `/account/deactivate_device` | `device_to_remove` |
| ⬜ | `/account/delete` | _—_ |
| ✅ | `/account/list_active_devices` | _—_ |
| ✅ | `/account/reset_profile_image` | `company_id`, `name`, `filter` |
| ⬜ | `/account/set_search_filter` | `company_id`, `name`, `filter` |
| ⬜ | `/account/set_user_display` | `user_display` |
| ⬜ | `/account/set_user_sorting` | `user_sorting` |
| ✅ | `/account/settings` | _—_ |
| ✅ | `/account/store_profile_image` | `company_id`, `name`, `filter` |
| ⬜ | `/account/toggle_allows_voip_calls` | `status` |
| ⬜ | `/account/toggle_device_notifications` | `status` |
| ⬜ | `/account/toggle_enter_is_newline` | `status` |
| ⬜ | `/account/toggle_notifications` | `status` |
| ⬜ | `/account/toggle_online_status` | `status` |
| ⬜ | `/account/toggle_read_status` | `status` |

## `/auth/*` — 15 Endpunkte (14 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/auth/cancel_auth_request` | _—_ |
| ⬜ | `/auth/change_password` | `token`, `password`, `password_repeat` |
| ⬜ | `/auth/check` | `app_name`, `encrypted`, `callable`, `key_transfer_support` |
| ⬜ | `/auth/get_device_by_auth_secret` | `auth_secret` |
| ⬜ | `/auth/get_password_restrictions` | `token`, `email` |
| ⬜ | `/auth/get_server_config` | `app_name` |
| ✅ | `/auth/login` | `email`, `password`, `app_name`, `encrypted`, `callable`, `key_transfer_support`, `token`, `recoveryCode` |
| ⬜ | `/auth/logout` | _—_ |
| ⬜ | `/auth/method` | `app_name`, `email`, `domain` |
| ⬜ | `/auth/notices` | `app_name` |
| ⬜ | `/auth/oauth` | `state`, `code`, `domain` |
| ⬜ | `/auth/request` | `app_name`, `auth_type`, `email`, `devicePublicKey` |
| ⬜ | `/auth/reset_password` | `email` |
| ⬜ | `/auth/time` | `app_name`, `email`, `domain` |
| ⬜ | `/auth/verify` | `auth_secret`, `action`, `encCommunicationKey`, `publicKey` |

## `/register/*` — 6 Endpunkte (6 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/register/activate` | `token`, `key`, `email`, `password`, `password_repeat`, `user_id` |
| ⬜ | `/register/auth` | `email`, `password` |
| ⬜ | `/register/check` | `email`, `password` |
| ⬜ | `/register/check_email` | `token` |
| ⬜ | `/register/check_register_token` | `key` |
| ⬜ | `/register/resend_validation_email` | `token`, `key`, `user_id` |

## `/security/*` — 25 Endpunkte (19 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/security/claim_onetime_keys` | `query` |
| ✅ | `/security/get_master_encryption_key` | _—_ |
| ✅ | `/security/get_missing_keys` | `user_id` |
| ⬜ | `/security/get_password` | _—_ |
| ⬜ | `/security/get_personal_access_keys` | _—_ |
| ✅ | `/security/get_private_key` | `format`, `type` |
| ⬜ | `/security/get_public_keys` | `user_ids`, `type` |
| ⬜ | `/security/get_session_keys` | `chat_mx_id`, `session_ids` |
| ⬜ | `/security/get_unclaimed_onetime_key_count` | _—_ |
| ✅ | `/security/get_verified_keys` | _—_ |
| ⬜ | `/security/list_device_to_device_messages` | `last_request_token` |
| ⬜ | `/security/lock_key_generation` | _—_ |
| ⬜ | `/security/query_device_keys` | `query` |
| ⬜ | `/security/query_devices` | `user_ids` |
| ⬜ | `/security/reset_content_key` | `channel_id`, `conversation_id` |
| ⬜ | `/security/reset_encryption` | _—_ |
| ⬜ | `/security/send_device_to_device_messages` | `messages` |
| ✅ | `/security/set_file_access_key` | `file_id`, `target`, `target_id`, `key`, `iv` |
| ✅ | `/security/set_missing_key` | `user_id`, `type`, `type_id`, `key`, `signature`, `expiry` |
| ⬜ | `/security/set_personal_access_keys` | `keys`, `signatures` |
| ⬜ | `/security/store_key_pair` | `private_key`, `public_key`, `type`, `format`, `signature` |
| ⬜ | `/security/store_master_encryption_key` | `ciphertext`, `signature` |
| ⬜ | `/security/store_session_keys` | `keys` |
| ⬜ | `/security/store_verified_key` | `key_fingerprint`, `signature`, `user_id` |
| ⬜ | `/security/upload_keys` | `mx_device_id`, `type`, `keys`, `fingerprint_key_signature` |

## `/notifications/*` — 3 Endpunkte (0 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/notifications/count` | _—_ |
| ✅ | `/notifications/delete` | `notification_id` |
| ✅ | `/notifications/get` | `limit`, `offset` |

## `/push/*` — 2 Endpunkte (0 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/push/disable_notifications` | `type`, `content_id`, `duration` |
| ✅ | `/push/enable_notifications` | `type`, `content_id` |

## `/company/*` — 4 Endpunkte (2 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ✅ | `/company/details` | `company_id` |
| ✅ | `/company/member` | `no_cache` |
| ⬜ | `/company/quit` | `company_id` |
| ⬜ | `/company/settings` | `company_id` |

## `/contacts/*` — 1 Endpunkte (1 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/contacts/profile` | _—_ |

## `/contracts/*` — 3 Endpunkte (3 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/contracts/details` | `contract_id`, `company_id`, `product`, `language` |
| ⬜ | `/contracts/sign` | `product`, `language`, `contract_id`, `company_id`, `first_name`, `last_name`, `address`, `street`, `city`, `zip`, `country` |
| ⬜ | `/contracts/status` | `company_id`, `product`, `language` |

## `/terms/*` — 3 Endpunkte (3 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/terms/accept` | `provider`, `product`, `language`, `term_id`, `accepted`, `contact`, `thirdparty` |
| ⬜ | `/terms/details` | `provider`, `product`, `language`, `term_id` |
| ⬜ | `/terms/status` | `provider`, `product`, `language` |

## `/link/*` — 2 Endpunkte (2 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/link/details` | `link` |
| ⬜ | `/link/short` | `link` |

## `/location/*` — 1 Endpunkte (1 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/location/get` | _—_ |

## `/translate/*` — 1 Endpunkte (1 offen)

| Status | Endpunkt | Parameter |
|---|---|---|
| ⬜ | `/translate/auto` | `text`, `language` |
