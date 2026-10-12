package com.example.text2ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    GatewayScreen()
                }
            }
        }
    }
}

@Composable
fun GatewayScreen() {
    Column(modifier = Modifier.padding(24.dp)) {
        Text("Text2AI Gateway")
        Text("Status: ready")
        Text("Permissions: RECEIVE_SMS, SEND_SMS, POST_NOTIFICATIONS")
    }
}
