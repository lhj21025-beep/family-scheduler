package com.familyscheduler.nativeapp

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings

class FamilySchedulerApp : Application() {
    companion object { lateinit var instance: FamilySchedulerApp }

    override fun onCreate() {
        super.onCreate()
        instance = this
        if (FirebaseApp.getApps(this).isEmpty()) {
            val options = FirebaseOptions.Builder()
                .setApiKey("AIzaSyBWaY0U1FVizj2qKNxC2brHihGW6E2HMR8")
                .setApplicationId("1:875374000769:android:8ab5c5a4d9e86ff9c8c8ab")
                .setProjectId("family-scheduler-44a8e")
                .setStorageBucket("family-scheduler-44a8e.firebasestorage.app")
                .setGcmSenderId("875374000769")
                .build()
            FirebaseApp.initializeApp(this, options)
        }
        FirebaseFirestore.getInstance().firestoreSettings = FirebaseFirestoreSettings.Builder()
            .setPersistenceEnabled(true)
            .build()
    }
}
