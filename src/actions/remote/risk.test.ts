import { describe, expect, test } from 'bun:test';
import { classifyCommand } from './risk.ts';

describe('classifyCommand', () => {
  test('reads classify as auto', () => {
    expect(classifyCommand('ls /etc')).toBe('auto');
    expect(classifyCommand('cat /etc/passwd')).toBe('auto');
    expect(classifyCommand('df -h')).toBe('auto');
    expect(classifyCommand('uptime')).toBe('auto');
    expect(classifyCommand('whoami')).toBe('auto');
    expect(classifyCommand('ps aux')).toBe('auto');
    expect(classifyCommand('VBoxManage list vms')).toBe('auto');
    expect(classifyCommand('VBoxManage showvminfo foo --machinereadable')).toBe('auto');
  });

  test('destructive commands always classify as destructive', () => {
    expect(classifyCommand('rm -rf /tmp/foo')).toBe('destructive');
    expect(classifyCommand('dd if=/dev/zero of=/dev/sda')).toBe('destructive');
    expect(classifyCommand('mkfs.ext4 /dev/sda1')).toBe('destructive');
    expect(classifyCommand('shutdown -h now')).toBe('destructive');
    expect(classifyCommand('reboot')).toBe('destructive');
    expect(classifyCommand('pkg delete python')).toBe('destructive');
    expect(classifyCommand('apt-get remove curl')).toBe('destructive');
    expect(classifyCommand('apt-get purge curl')).toBe('destructive');
    expect(classifyCommand('systemctl stop sshd')).toBe('destructive');
    expect(classifyCommand('VBoxManage controlvm foo poweroff')).toBe('destructive');
    expect(classifyCommand('VBoxManage unregistervm foo')).toBe('destructive');
    expect(classifyCommand('VBoxManage snapshot foo delete bar')).toBe('destructive');
  });

  test('compound commands never auto-approve', () => {
    expect(classifyCommand('ls | grep foo')).toBe('first_contact');
    expect(classifyCommand('cat /etc/passwd ; rm /tmp/foo')).toBe('first_contact');
    expect(classifyCommand('df > /tmp/out')).toBe('first_contact');
    expect(classifyCommand('echo $(whoami)')).toBe('first_contact');
    expect(classifyCommand('uname -a && reboot')).toBe('destructive'); // reboot wins
    expect(classifyCommand('uname -a && uptime')).toBe('first_contact');
  });

  test('sudo never auto-approves', () => {
    expect(classifyCommand('sudo ls /root')).toBe('first_contact');
    expect(classifyCommand('sudo cat /etc/shadow')).toBe('first_contact');
  });

  test('unknown commands default to first_contact', () => {
    expect(classifyCommand('docker ps')).toBe('first_contact');
    expect(classifyCommand('helm install foo bar')).toBe('first_contact');
    expect(classifyCommand('')).toBe('first_contact');
  });

  test('non-destructive rm without recursive flag still falls through', () => {
    // Plain `rm foo` without -r/-f is dangerous but not auto-able either.
    expect(classifyCommand('rm /tmp/some-file')).toBe('first_contact');
  });
});
