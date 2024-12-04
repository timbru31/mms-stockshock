[1mdiff --git a/package-lock.json b/package-lock.json[m
[1mindex faab7ee..2d381e2 100644[m
[1m--- a/package-lock.json[m
[1m+++ b/package-lock.json[m
[36m@@ -10,7 +10,6 @@[m
             "license": " GPL-3.0-or-later",[m
             "dependencies": {[m
                 "@aws-sdk/client-dynamodb": "^3.705.0",[m
[31m-                "@types/uuid": "^10.0.0",[m
                 "date-fns": "^4.1.0",[m
                 "discord.js": "^14.16.3",[m
                 "inquirer": "^8.2.6",[m
[36m@@ -1923,12 +1922,6 @@[m
             "dev": true,[m
             "license": "MIT"[m
         },[m
[31m-        "node_modules/@types/uuid": {[m
[31m-            "version": "10.0.0",[m
[31m-            "resolved": "https://registry.npmjs.org/@types/uuid/-/uuid-10.0.0.tgz",[m
[31m-            "integrity": "sha512-7gqG38EyHgyP1S+7+xomFtL+ZNHcKv6DwNaCZmJmo1vgMugyF3TCnXVg4t1uk89mLNwnLtnY3TpOpCOyp1/xHQ==",[m
[31m-            "license": "MIT"[m
[31m-        },[m
         "node_modules/@types/ws": {[m
             "version": "8.5.13",[m
             "resolved": "https://registry.npmjs.org/@types/ws/-/ws-8.5.13.tgz",[m
[1mdiff --git a/package.json b/package.json[m
[1mindex d55ca4a..c3e3b61 100644[m
[1m--- a/package.json[m
[1m+++ b/package.json[m
[36m@@ -23,7 +23,6 @@[m
     },[m
     "dependencies": {[m
         "@aws-sdk/client-dynamodb": "^3.705.0",[m
[31m-        "@types/uuid": "^10.0.0",[m
         "date-fns": "^4.1.0",[m
         "discord.js": "^14.16.3",[m
         "inquirer": "^8.2.6",[m
