# Android gateway

This folder contains the Android SMS gateway skeleton for the Text2AI app.

## Requirements

- Android Studio or the Android SDK
- JDK 17+
- A spare Android phone or emulator

## Install steps

1. Install Android Studio or the Android SDK.
2. Enable developer mode and allow unknown sources.
3. Grant SMS permissions and notification permissions on the device.
4. Build the app with:
   ./gradlew assembleDebug
5. Install the APK on the spare phone.

## Notes

- The app never stores TinyFish or LLM keys.
- It only knows the backend URL and its device token.
- This is a scaffold for the SMS receiver, foreground service, and queue logic.
