/* global console */

import modes from './lib/visualisations'
import {
	putLedsInBufferArray,
	regroupConfig
} from './lib/helpers/dataHelpers'
import { connectToArduinos } from './lib/helpers/connectToArduinos.js'
import { spinServer } from './lib/helpers/spinServer.js'
import { NUMBER_OF_LEDS } from './lib/configuration/constants.js'
import earConfig from './lib/helpers/config'

const connectedSockets = {}
const clientConfigurations = earConfig.read()
let ledsConfig
let currentMode = modes.basic
let areWeWriting = true
let clientSensors

const io = spinServer()
const realSensors = connectToArduinos()

const calculateDataForRealLeds = (data, realSensor) => { // TO BE CHANGED WHEN HAVE ACCESS TO HARDWARE
	const sensorData = data.split('\t')[0].split('! ')[1]
	realSensor.update(sensorData)

	// let config = clientConfigurations[socket.id]
	// if (!config) {
	// 	return
	// }

	// const sticks = config.sticks
	// if (!sticks) {
	// 	return
	// }

	const sticks = [
		{
			numberOfLEDs: 40,
			name: '1'
		},
		{
			numberOfLEDs: 40,
			name: '2'
		},
	]
	//console.log(clientSensors)
	const ledsConfigFromClient = currentMode(sticks, clientSensors).filter(Boolean)
	//const ledsConfigFromHardware = currentMode(sticks, realSensor).filter(Boolean)
	ledsConfig = regroupConfig(ledsConfigFromClient)

	return putLedsInBufferArray(ledsConfig[0].leds, NUMBER_OF_LEDS)
}

if (realSensors && realSensors.length > 0) {
	realSensors.map(realSensor => {
		const port = realSensor.port
		const parser = realSensor.parser

		parser.on('data', data => {
			if (areWeWriting && ledsConfig) {
				//console.log('DATA IN', data)
				port.write(calculateDataForRealLeds(data, realSensor))
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

io.on('connection', socket => {
	connectedSockets[socket.id] = socket

	socket.on('updatedSensors', sensors => {
		if (!sensors) return

		let config = clientConfigurations[socket.id]
		if (!config) {
			return
		}

		const sticks = config.sticks
		if (!sticks) {
			return
		}

		currentMode = modes[config.mode]
		if (!currentMode) {
			return
		}

		clientSensors = sensors
		const ledsConfigFromClient = currentMode(sticks, sensors).filter(Boolean)
		ledsConfig = regroupConfig(ledsConfigFromClient)
		socket.emit('ledsChanged', ledsConfig)
		// ledsConfigFromClient.map(ledConfig => socket.emit('ledsChanged', ledConfig)) // keep for now for development processes
	})

	socket.on('configure', configuration => {
		clientConfigurations[socket.id] = configuration
		earConfig.save()
	})

	socket.on('disconnect', () => {
		delete connectedSockets[socket.id]
		delete clientConfigurations[socket.id]
	})
})
