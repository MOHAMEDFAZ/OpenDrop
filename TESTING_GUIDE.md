# Testing Guide: Multi-User & Multi-Device OpenDrop

## Overview

OpenDrop now supports multiple users in the same room and works across different devices. You can share files between your laptop and your friends' devices (phones, tablets, other laptops) all in the same room.

## Quick Start

### 1. Start the Server

On your laptop, navigate to the project directory and start the server:

```bash
cd opendrop
npm start
```

The server will start on `http://localhost:3000` by default.

### 2. Find Your Network IP Address

To allow other devices to connect, you need to find your laptop's local network IP address:

**On macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**On Windows:**
```bash
ipconfig
```

Look for an IP address like `192.168.x.x` or `10.0.x.x` (this is your local network IP).

### 3. Access from Different Devices

#### From Your Laptop:
- Open browser and go to: `http://localhost:3000`

#### From Other Devices (Friends' phones, tablets, etc.):
- Make sure they're on the **same Wi-Fi network** as your laptop
- Open browser and go to: `http://YOUR_IP_ADDRESS:3000`
  - Example: `http://192.168.1.100:3000`

## Testing Scenarios

### Scenario 1: Basic Multi-User Test (2-3 People)

1. **Person A (You - Laptop):**
   - Enter your name (e.g., "Mohamed")
   - Click "Create Room"
   - Share the 6-digit room code with your friends

2. **Person B (Friend - Phone/Tablet):**
   - Enter their name (e.g., "Sarah")
   - Enter the room code
   - Click "Join Room"

3. **Person C (Another Friend - Laptop):**
   - Enter their name (e.g., "Alex")
   - Enter the same room code
   - Click "Join Room"

4. **Verify:**
   - All three people should see each other in the "Connected Users" list
   - Each person should see "Connected" status next to other users
   - The file transfer panel should appear for everyone

### Scenario 2: Send File from Laptop to Friend's Phone

1. **On Your Laptop:**
   - Select a file using the file picker
   - Choose your friend's name from the "Select a peer..." dropdown
   - Click "Send File"

2. **On Your Friend's Phone:**
   - A popup will appear showing the file name and size
   - Click "Accept" to receive the file
   - Watch the progress bar
   - File will automatically download when complete

### Scenario 3: Multiple Simultaneous Transfers

1. **Person A sends to Person B:**
   - Person A selects a file and chooses Person B from dropdown
   - Person B accepts

2. **While that's transferring, Person C sends to Person A:**
   - Person C selects a file and chooses Person A
   - Person A accepts
   - Both transfers should work simultaneously

### Scenario 4: Test Across Different Devices

**Devices to test with:**
- Your laptop (Chrome/Firefox/Safari)
- Friend's iPhone (Safari)
- Friend's Android phone (Chrome)
- Friend's iPad/Tablet
- Another laptop (different browser)

**All devices should:**
- Be able to join the same room
- See all other connected users
- Send and receive files to/from any other user

## Troubleshooting

### Problem: Friends can't connect to `http://YOUR_IP:3000`

**Solutions:**
1. Make sure all devices are on the **same Wi-Fi network**
2. Check your laptop's firewall - it might be blocking port 3000
3. Try using your laptop's hostname instead of IP (e.g., `http://your-laptop-name.local:3000`)
4. Verify the server is running and accessible from your laptop at `http://localhost:3000`

### Problem: Users can't see each other

**Solutions:**
1. Make sure everyone entered the same 6-digit room code
2. Check the browser console for errors (F12 → Console tab)
3. Try refreshing the page and rejoining
4. Make sure WebRTC is supported (most modern browsers support it)

### Problem: File transfer is slow or fails

**Solutions:**
1. WebRTC uses P2P - make sure devices are on the same network for best performance
2. Large files may take time - check the progress bar
3. If transfer fails, try sending a smaller file first to test
4. Check that both devices have stable Wi-Fi connection

### Problem: "Room not found" error

**Solutions:**
1. Make sure someone created the room first
2. Room codes are case-sensitive - enter exactly as shown
3. Try creating a new room if the old one expired

## Network Configuration

### If Testing Over Internet (Not Same Network)

For testing across the internet (different networks), you'll need:

1. **Port Forwarding:** Forward port 3000 on your router to your laptop
2. **Public IP:** Use your public IP address instead of local IP
3. **TURN Server:** WebRTC may need a TURN server for NAT traversal

**Note:** For production use, consider deploying to a cloud service (Heroku, Railway, etc.) for easier access.

### Firewall Settings

**macOS:**
- System Preferences → Security & Privacy → Firewall
- Allow incoming connections for Node.js

**Windows:**
- Windows Defender Firewall → Allow an app
- Allow Node.js through firewall

**Linux:**
```bash
sudo ufw allow 3000
```

## Tips for Best Results

1. **Use modern browsers:** Chrome, Firefox, Safari, Edge (latest versions)
2. **Same network:** For best performance, all devices should be on the same Wi-Fi
3. **Stable connection:** Ensure good Wi-Fi signal strength
4. **Start small:** Test with small files first (images, text files) before large videos
5. **Check browser console:** If something doesn't work, check the browser console (F12) for errors

## Example Test Flow

```
1. You (Laptop): Create room "123456", name "Mohamed"
2. Friend 1 (Phone): Join room "123456", name "Sarah"
3. Friend 2 (Tablet): Join room "123456", name "Alex"
4. All three see each other in the user list
5. You send a photo to Sarah → Sarah accepts → Photo downloads on Sarah's phone
6. Alex sends a document to you → You accept → Document downloads on your laptop
7. Sarah sends a video to Alex → Alex accepts → Video downloads on Alex's tablet
```

## Security Notes

- Files are transferred **directly** between devices (P2P) - the server never sees file contents
- Only signaling messages go through the server
- Anyone with the room code can join - share codes only with trusted people
- For production, consider adding authentication or room passwords

## Need Help?

If you encounter issues:
1. Check browser console for errors
2. Verify all devices are on the same network
3. Try creating a new room
4. Restart the server if needed

Happy testing! 🚀
