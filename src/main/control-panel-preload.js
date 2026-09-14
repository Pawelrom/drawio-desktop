const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelBridge',
{
	sendCmd: function (type, payload)
	{
		ipcRenderer.send('ext-cmd', {type: type, payload: payload || {}});
	},
	onResult: function (type, callback)
	{
		ipcRenderer.on('ext-result', function (event, msg)
		{
			if (msg && msg.type === type) callback(msg);
		});
	}
});
