#define _GNU_SOURCE
#include <stdlib.h>
#include <locale.h>

long __isoc23_strtol(const char *nptr, char **endptr, int base) {
  return strtol(nptr, endptr, base);
}
unsigned long __isoc23_strtoul(const char *nptr, char **endptr, int base) {
  return strtoul(nptr, endptr, base);
}
long long __isoc23_strtoll(const char *nptr, char **endptr, int base) {
  return strtoll(nptr, endptr, base);
}
unsigned long long __isoc23_strtoull(const char *nptr, char **endptr, int base) {
  return strtoull(nptr, endptr, base);
}
long __isoc23_strtol_l(const char *nptr, char **endptr, int base, locale_t loc) {
  return strtol_l(nptr, endptr, base, loc);
}
unsigned long __isoc23_strtoul_l(const char *nptr, char **endptr, int base, locale_t loc) {
  return strtoul_l(nptr, endptr, base, loc);
}
long long __isoc23_strtoll_l(const char *nptr, char **endptr, int base, locale_t loc) {
  return strtoll_l(nptr, endptr, base, loc);
}
unsigned long long __isoc23_strtoull_l(const char *nptr, char **endptr, int base, locale_t loc) {
  return strtoull_l(nptr, endptr, base, loc);
}
