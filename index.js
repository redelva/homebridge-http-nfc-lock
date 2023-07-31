let Service, Characteristic
const packageJson = require('./package.json')
const request = require('request')

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-http-nfc-lock', 'HTTPLock', HTTPLock)
}

function HTTPLock (log, config) {
  this.log = log

  this.name = config.name
  this.apiroute = config.apiroute

  this.autoLock = config.autoLock || false
  this.autoLockDelay = config.autoLockDelay || 10

  this.manufacturer = config.manufacturer || packageJson.author
  this.serial = config.serial || this.apiroute
  this.model = config.model || packageJson.name
  this.firmware = config.firmware || packageJson.version

  this.username = config.username || null
  this.password = config.password || null
  this.timeout = config.timeout || 5000
  this.http_method = config.http_method || 'GET'

  this.pollInterval = config.pollInterval || 120

  if (this.username != null && this.password != null) {
    this.auth = {
      user: this.username,
      pass: this.password
    }
  }

  this.lockMechanismService = new Service.LockMechanism(this.name)
  this.lockManagementService = new Service.LockManagement(this.name)


  this.nfcAccessService = new Service.NFCAccess(this.name)
  this.nfcAccessService.setCharacteristic(Characteristic.NFCAccessSupportedConfiguration, "AQEQAgEQ");
}

HTTPLock.prototype = {

  identify: function (callback) {
    this.log('Identify requested!')
    callback()
  },

  _httpRequest: function (url, body, method, callback) {
    request({
      url: url,
      body: body,
      method: this.http_method,
      timeout: this.timeout,
      rejectUnauthorized: false,
      auth: this.auth
    },
    function (error, response, body) {
      callback(error, response, body)
    })
  },

  _getStatus: function (callback) {
    const url = this.apiroute + '/status'
    this.log.debug('Getting status: %s', url)

    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error getting status: %s', error.message)
        this.lockMechanismService.getCharacteristic(Characteristic.LockCurrentState).updateValue(new Error('Polling failed'))
        callback(error)
      } else {
        this.log.debug('Device response: %s', responseBody)
        try {
          const json = JSON.parse(responseBody)
          this.lockMechanismService.getCharacteristic(Characteristic.LockCurrentState).updateValue(json.currentState)
          this.lockMechanismService.getCharacteristic(Characteristic.LockTargetState).updateValue(json.currentState)
          this.log.debug('Updated state to: %s', json.currentState)
          callback()
        } catch (e) {
          this.log.warn('Error parsing status: %s', e.message)
        }
      }
    }.bind(this))
  },

  setLockTargetState: function (value, callback) {
    const url = this.apiroute + '/setState?value=' + value
    this.log.debug('Setting state: %s', url)

    this._httpRequest(url, '', this.http_method, function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error setting state: %s', error.message)
        callback(error)
      } else {
        this.log('Set state to %s', value)
        this.lockMechanismService.getCharacteristic(Characteristic.LockCurrentState).updateValue(value)
        if (value === 1 && this.autoLock) {
          this.autoLockFunction()
        }
        callback()
      }
    }.bind(this))
  },

  autoLockFunction: function () {
    this.log('Waiting %s seconds for autolock', this.autoLockDelay)
    setTimeout(() => {
      this.lockMechanismService.setCharacteristic(Characteristic.LockTargetState, 1)
      this.log('Autolocking...')
    }, this.autoLockDelay * 1000)
  },

  getServices: function () {
    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmware)

    this.lockMechanismService
      .getCharacteristic(Characteristic.LockTargetState)
      .on('set', this.setLockTargetState.bind(this))

    this.nfcAccessService.setCharacteristic(Characteristic.NFCAccessSupportedConfiguration, "AQEQAgEQ");

    this.nfcAccessService
        .getCharacteristic(Characteristic.ConfigurationState)
        .on(CharacteristicEventTypes.GET, callback => {
          console.log("Queried config state: ");
          callback(undefined, 0);
        });
    this.nfcAccessService
        .getCharacteristic(Characteristic.NFCAccessControlPoint)
        .on(CharacteristicEventTypes.SET, (value, callback) => {
          console.log("Control Point Write: " + value);
          callback(undefined, "");
        });

    this._getStatus(function () {})

    setInterval(function () {
      this._getStatus(function () {})
    }.bind(this), this.pollInterval * 1000)

    return [this.informationService, this.lockMechanismService, this.lockManagementService, this.lockMechanismService, this.nfcAccessService]
  }
}
