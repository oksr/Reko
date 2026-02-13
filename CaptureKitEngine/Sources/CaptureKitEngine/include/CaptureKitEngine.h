#ifndef CAPTUREKIT_ENGINE_H
#define CAPTUREKIT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int32_t CKResult;
#define CK_OK 0
#define CK_ERROR -1

// Version
const char* ck_get_version(void);

// Source discovery
CKResult ck_list_displays(const char **out_json);
CKResult ck_list_audio_inputs(const char **out_json);

// Recording
CKResult ck_start_recording(const char *config_json, uint64_t *out_session_id);
CKResult ck_stop_recording(uint64_t session_id, const char **out_result_json);

// Memory
void ck_free_string(char *str);

#ifdef __cplusplus
}
#endif

#endif
