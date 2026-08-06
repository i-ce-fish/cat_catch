export const IPC = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHOOSE_DIR: 'settings:chooseDir',
  SETTINGS_OPEN_DIR: 'settings:openDir',

  TASK_SUBMIT_SINGLE: 'task:submitSingle',
  TASK_SUBMIT_BATCH: 'task:submitBatch',
  TASK_RETRY: 'task:retry',
  TASK_LIST: 'task:list',
  TASK_UPDATE_EVENT: 'task:update',
  TASK_OPEN_OUTPUT: 'task:openOutput',

  LOGIN_START: 'login:start',
  LOGIN_LOGOUT: 'login:logout',
  LOGIN_GET_STATUS: 'login:getStatus',
  LOGIN_STATUS_EVENT: 'login:status',
};

export const MEDIA_TYPE = { VIDEO: 'video', AUDIO: 'audio' };

export const TASK_STATUS = {
  QUEUED: 'queued',
  SNIFFING: 'sniffing',
  RETRYING: 'retrying',
  DOWNLOADING: 'downloading',
  SUCCESS: 'success',
  FAILED: 'failed',
};

export const MAX_SNIFF_ATTEMPTS = 3;

export const FORMAT_OPTIONS = {
  video: [{ value: 'mp4', label: 'MP4' }],
  audio: [
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
    { value: 'm4a', label: 'M4A' },
  ],
};

export const DEFAULT_SETTINGS = {
  outDir: '',
  mediaType: MEDIA_TYPE.VIDEO,
  transcode: true,
  format: 'mp4',
  concurrency: 6,
};
