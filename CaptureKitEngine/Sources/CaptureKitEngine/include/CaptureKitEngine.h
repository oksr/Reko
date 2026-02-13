#ifndef CAPTUREKIT_ENGINE_H
#define CAPTUREKIT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int32_t CKResult;
#define CK_OK 0
#define CK_ERROR -1

const char* ck_get_version(void);
void ck_free_string(char *str);

// Source discovery
CKResult ck_list_displays(const char **out_json);

#ifdef __cplusplus
}
#endif

#endif
