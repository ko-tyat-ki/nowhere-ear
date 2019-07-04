/* global console */

import modes from './lib/visualisations'
import {
	putLedsInBufferArray,
	regroupConfig,
	getInfoFromSensors
} from './lib/helpers/dataHelpers'
import { connectToArduinos } from './lib/helpers/connectToArduinos'
import { spinServer } from './lib/helpers/spinServer'
import { NUMBER_OF_LEDS } from './lib/configuration/constants'
import earConfig from './lib/helpers/config'
import { writeToPython } from './lib/helpers/communicateWithPython'
import { realSticks } from './lib/configuration/realSticksConfig'
import { easterEgg, isEasterTriggered, easterEggDuration } from './lib/modes/easterEgg'
import { onChangeSpeed, onChange } from './lib/modes/onChange'
import sleep from './lib/modes/sleep'
import {
	wasStretchedHardEnoughToWakeUp
} from './lib/helpers/sleepTracker'

const connectedSockets = {}
const clientConfigurations = {}
let ledsConfig = [] // Needs to be initially an empty array to trigger communication with the arduino
let isAutoChangingModeEnabled = true
let modeAutoChangeInterval = 3 * 60 * 1000 // 3 minutes

let currentModeKey = 'flicker'
let currentMode = modes[currentModeKey]
let previousModeKey = 'flicker'
let clientSensors = []
let realSensorsData = []

let isSleeping = false
let noActionsSince = Date.now()
let lastTimeAutoChangedMode = Date.now()
let onChangeStarted
const goToSleepAfter = 30 * 60 * 1000

let easterEggTriggeredAt
let isEaster = false
let isOnChange = false

const useOnChange = true
const useEasterEgg = true
const useSleepMode = true
const onChangeDuration = onChangeSpeed * 15 // This magic number comed from the nature of onChange

// Select visualisation modes
setInterval(() => {
	const combinedSensors = [...clientSensors, ...realSensorsData]
	if (useEasterEgg) {
		if (!isEaster && isEasterTriggered(combinedSensors)) {
			previousModeKey = currentModeKey
			currentMode = easterEgg
			easterEggTriggeredAt = Date.now()
			isEaster = true
		}

		if (isEaster && Date.now() - easterEggTriggeredAt > easterEggDuration) {
			changeMode(previousModeKey)
			isEaster = false
		}
	}

	const modesKeys = Object.keys(modes)
	if (!isSleeping && isAutoChangingModeEnabled && Date.now() - lastTimeAutoChangedMode > modeAutoChangeInterval) {
		const nextRandomKey = modesKeys.filter(modeKey => modeKey !== currentModeKey)[Math.floor(Math.random() * (modesKeys.length - 1))]
		if (useOnChange) {
			onChangeStarted = Date.now()
			currentModeKey = nextRandomKey
			currentMode = onChange
			isOnChange = true
		} else changeMode(nextRandomKey)
		lastTimeAutoChangedMode = Date.now()
		return
	}

	if (isOnChange && Date.now() - onChangeStarted > onChangeDuration) {
		onChangeStarted = false
		isOnChange = false
		changeMode(currentModeKey)
	}

	if (useSleepMode) {
		if (wasStretchedHardEnoughToWakeUp(combinedSensors)) {
			if (isSleeping) changeMode(previousModeKey)
			noActionsSince = Date.now()
			isSleeping = false
			return
		}

		if (Date.now() - noActionsSince > goToSleepAfter) {
			if (!isSleeping) currentMode = sleep
			isSleeping = true
			return
		}
	}
}, 50)

const changeMode = (modeKey) => {
	console.log(`Mode was changed from ${previousModeKey} to ${currentModeKey}`)
	previousModeKey = currentModeKey
	currentModeKey = modeKey
	currentMode = modes[modeKey]
	Object.keys(clientConfigurations).map(socketId => {
		connectedSockets[socketId].emit('modeChanged', modeKey)
	})
}

const applyMode = () => {
	const combinedLedsConfig = currentMode(realSticks, [...clientSensors, ...realSensorsData])

	if (!combinedLedsConfig) return []

	return regroupConfig(combinedLedsConfig.filter(Boolean))
};

// Talk to arduinos
const realSensors = connectToArduinos()

const calculateDataForRealLeds = (sensorData, realSensor, stick) => {
	realSensor.update(sensorData)

	realSensorsData = realSensors.map(sensor => ({
		tension: sensor.tension,
		oldTension: sensor.oldTension,
		sensorPosition: sensor.sensorPosition,
		stick: sensor.stick,
		slowSensorValue: sensor.slowSensorValue,
		fastSensorValue: sensor.fastSensorValue,
		key: sensor.key
	}))

	ledsConfig = applyMode()

	const stickLeds = ledsConfig.find(config => config.key === stick).leds
	return putLedsInBufferArray(stickLeds, NUMBER_OF_LEDS)
}

if (realSensors && realSensors.length > 0) {
	realSensors.map(realSensor => {
		const port = realSensor.port
		const parser = realSensor.parser
		let areWeWriting = true

		parser.on('data', data => {
			if (areWeWriting && ledsConfig && ledsConfig.length > 0) {
				// console.log({ data, key: realSensor.key })
				port.write(calculateDataForRealLeds(getInfoFromSensors(data), realSensor, realSensor.stick))
				areWeWriting = false
			} else {
				//console.log('Data IN, listen', data)
				if (data === 'eat me\r') {
					areWeWriting = true
				}
			}
		})
	})
}

// Talk to python
setInterval(() => {
	const combinedSensors = [...clientSensors, ...realSensorsData]
	if (combinedSensors.length > 0) writeToPython(combinedSensors, currentModeKey)
}, 100)

// Special requests handlers
// Are here to talk to global variables as it is a bit cheaper
const modeHandler = (req, res) => {
	currentModeKey = req.query.name
	currentMode = modes[currentModeKey]
	Object.keys(clientConfigurations).map(socketId => {
		connectedSockets[socketId].emit('modeChanged', currentModeKey)
	})
	res.send('Done!')
};

const switchAutomaticModeHandler = (req, res) => {
	isAutoChangingModeEnabled = !isAutoChangingModeEnabled
	const timeout = req.query.timeout
	if (timeout) {
		modeAutoChangeInterval = timeout
	}
	res.send('Done! Autoswitching enabled ' + isAutoChangingModeEnabled + '. Change once in ' + modeAutoChangeInterval / 1000 / 60 + ' minutes')
}

const arduinosStatusHandler = (req, res) => {
	const activeArduinos = realSensors.filter(sensor => sensor.active).map(sensor => ({
		name: sensor.key,
		stick: sensor.stick
	}))
	const arduinosThatDidNotOpen = realSensors.filter(sensor => !sensor.active).map(sensor => ({
		name: sensor.key,
		stick: sensor.stick
	}))
	res.json({
		activeArduinos,
		arduinosThatDidNotOpen
	})
};

// Talk to client
const io = spinServer([
	{
		method: 'get',
		path: '/mode',
		callback: modeHandler
	},
	{
		method: 'get',
		path: '/mode/automatic',
		callback: switchAutomaticModeHandler
	},
	{
		method: 'get',
		path: '/arduinosStatus',
		callback: arduinosStatusHandler
	}
])

io.on('connection', socket => {
	connectedSockets[socket.id] = socket

	socket.on('updatedSensors', sensors => {
		if (!sensors) return

		let config = clientConfigurations[socket.id]
		if (!config) {
			return
		}

		clientSensors = sensors
		ledsConfig = applyMode()
		socket.emit('ledsChanged', ledsConfig)
	})

	socket.on('configure', configuration => {
		currentModeKey = configuration.mode
		currentMode = modes[currentModeKey]
		clientConfigurations[socket.id] = configuration
		noActionsSince = Date.now()
		isSleeping = false
		earConfig.save(clientConfigurations)
	})

	socket.on('disconnect', () => {
		delete connectedSockets[socket.id]
		delete clientConfigurations[socket.id]
	})
})

